import { matchesAny, normalizePath } from './globs.js';
import { isCengCli, parseCommand, shellWords, splitCommand, splitPipes, type ShellKind, type Statement } from './shell.js';
import * as path from 'node:path';
import type { Autonomy, Stage } from './types.js';

export { splitCommand };

/**
 * Classification des actions : AUTONOMOUS vs HUMAN APPROVAL REQUIRED vs FORBIDDEN.
 * Défense en profondeur (s'ajoute aux règles `deny` natives de Claude Code) ;
 * ce n'est pas un sandbox : une commande obfusquée peut passer, d'où la recommandation
 * d'activer le sandbox OS pour une autonomie élevée.
 */

export type ActionClass = 'autonomous' | 'approval' | 'forbidden';

export interface Verdict {
  class: ActionClass;
  reason: string;
  rule?: string;
  /** Présent quand la seule raison d'approbation est une suppression de fichiers (rendue récupérable par le hook). */
  deletion?: Deletion;
  /** Règles qui auraient demandé une approbation et que le stade `prototype` laisse passer (le hook les journalise, prend un instantané si besoin). */
  freed?: string[];
}

interface Rule {
  id: string;
  pattern: RegExp;
  reason: string;
  /** Rend la règle muette pour un simple essai à blanc (`--dry-run`) : rien n'est publié, déployé ni appliqué. */
  dryRunSafe?: boolean;
  /** Cherche aussi dans le texte entre guillemets (la règle protège les garde-fous eux-mêmes). */
  scanQuoted?: boolean;
}

const DRY_RUN = /--dry-run(?!=(?:none|false))\b/;

const FORBIDDEN: Rule[] = [
  { id: 'rm-root', pattern: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+(\/|~|\$HOME|\/\*|~\/\*|[A-Za-z]:[\\/]?)(\s|$)/, reason: 'Suppression récursive de la racine ou du répertoire personnel.' },
  { id: 'fork-bomb', pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/, reason: 'Fork bomb.' },
  { id: 'disk-format', pattern: /\b(mkfs(\.\w+)?|format\s+[A-Za-z]:)\b/i, reason: 'Formatage de disque.' },
  { id: 'dd-device', pattern: /\bdd\b.*\bof=\/dev\/(sd|nvme|disk|hd)/, reason: 'Écriture brute sur un périphérique.' },
  { id: 'curl-pipe-shell', pattern: /\b(curl|wget|iwr|Invoke-WebRequest)\b[^|]*\|\s*(sudo\s+)?(ba|z|fi)?sh\b|\b(iex|Invoke-Expression)\b.*\b(iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b/i, reason: 'Téléchargement et exécution de code non vérifié.' },
  { id: 'dump-env', pattern: /^\s*(printenv|env|set|Get-ChildItem\s+env:|gci\s+env:|dir\s+env:)\s*$/i, reason: 'Exposition de toutes les variables d\'environnement (secrets probables).' },
  { id: 'chmod-777-root', pattern: /\bchmod\s+(-R\s+)?777\s+\/(\s|$)/, reason: 'Permissions universelles sur la racine.' },
  { id: 'disable-guardrails', pattern: /(\bdisableAllHooks\b|--dangerously-skip-permissions\b)/, reason: 'Désactivation des garde-fous.', scanQuoted: true },
];

const APPROVAL: Rule[] = [
  { id: 'secrets-allow', pattern: /\b(cli\.js|ceng)\s+secrets\s+(allow|grant)\b/, reason: 'Autoriser l\'accès à un fichier de secrets : décision humaine.' },
  { id: 'config-apply', pattern: /\b(cli\.js|ceng)\s+config\s+detect\b[^|;&\n]*--apply\b/, reason: 'Réécriture des commandes de gates dans .ceng/config.json (fichier de garde-fous) : décision humaine.' },
  { id: 'config-stage', pattern: /\b(cli\.js|ceng)\s+config\s+stage\s+(prototype|production)\b/, reason: 'Changer le stade du projet (prototype/production) modifie le niveau des garde-fous : décision humaine.' },
  { id: 'git-force-push', pattern: /\bgit\s+push\b.*(\s--force(-with-lease)?\b|\s-f\b|\s\+\S+)/, reason: 'Push forcé : réécrit un historique partagé.' },
  { id: 'git-discard', pattern: /\bgit\s+(reset\s+--hard\b|clean\s+-[a-zA-Z]*f[a-zA-Z]*|checkout\s+(--\s+)?\.(\s|$)|restore\s+(--\S+\s+)*\.(\s|$)|stash\s+(drop|clear)\b|branch\s+-D\b)/, reason: 'Peut détruire du travail non commité ou une branche.' },
  { id: 'git-history-rewrite', pattern: /\bgit\s+(rebase(?!\s+--(?:abort|continue|skip|quit)\b)|filter-branch|filter-repo|commit\s+--amend)\b/, reason: 'Réécriture d\'historique.' },
  { id: 'publish', pattern: /\b(npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bgem\s+push\b|\bdotnet\s+nuget\s+push\b|\bflutter\s+pub\s+publish\b|\bdocker\s+push\b/, reason: 'Publication d\'un artefact public.', dryRunSafe: true },
  { id: 'deploy', pattern: /\b(vercel\b.*--prod|netlify\s+deploy\b.*--prod|fly\s+deploy|flyctl\s+deploy|firebase\s+deploy|gcloud\b.*\bdeploy\b|aws\b.*\b(deploy|update-function-code|cloudformation\s+(deploy|create-stack|update-stack))\b|serverless\s+deploy|sls\s+deploy|eb\s+deploy|heroku\s+(releases|ps:scale|config:set)|kamal\s+deploy|cdk\s+deploy|pulumi\s+up|railway\s+up|render\s+deploy)/i, reason: 'Déploiement.', dryRunSafe: true },
  { id: 'infra-change', pattern: /\b(terraform|tofu)\s+(apply|destroy|import|state\s+(rm|mv))\b|\bkubectl\s+(apply|delete|replace|patch|scale|rollout\s+undo|drain)\b|\bhelm\s+(install|upgrade|uninstall|rollback)\b/, reason: 'Changement d\'infrastructure.', dryRunSafe: true },
  { id: 'db-destructive', pattern: /\b(drop\s+(table|database|schema)|truncate\s+(table\s+)?\w|delete\s+from\s+\w+\s*;?\s*$)|\b(prisma\s+(migrate\s+reset|db\s+push\s+--force-reset)|supabase\s+db\s+(reset|push)|rails\s+db:(drop|reset)|manage\.py\s+flush|alembic\s+downgrade)\b/i, reason: 'Opération destructive ou migration sur base de données.' },
  { id: 'prod-migrate', pattern: /\b(prisma\s+migrate\s+deploy|knex\s+migrate:latest\s+.*prod|(?:NODE_ENV|RAILS_ENV|APP_ENV)=production\b.*\b(?:migrat\w*|db:\w+|seed|drop|reset|deploy)\b|--env[= ]prod)/i, reason: 'Action ciblant la production.' },
  { id: 'sudo', pattern: /(^|[;&|]\s*)sudo\b/, reason: 'Élévation de privilèges.' },
  { id: 'gh-destructive', pattern: /\bgh\s+(repo\s+(delete|archive|edit\s+.*--visibility)|release\s+(create|delete)|secret\s+set|api\s+.*-X\s*DELETE)\b/, reason: 'Action GitHub irréversible ou sensible.' },
  { id: 'secrets-mgmt', pattern: /\b(vault\s+(write|delete|kv\s+(put|delete))|aws\s+secretsmanager\s+(put|delete|create)|gcloud\s+secrets\s+(create|delete|versions\s+add))\b/, reason: 'Gestion de secrets.' },
  { id: 'kill-all', pattern: /\b(killall|pkill\s+-9|taskkill\s+\/f\s+\/im)\b/i, reason: 'Arrêt de processus en masse.' },
];

/** Répertoires régénérables dont la suppression récursive est sans risque. */
const REGENERABLE_DIRS = ['node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.turbo', 'coverage', 'target', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.dart_tool', '.gradle', 'tmp', '.tmp', '.cache', '.parcel-cache', '.svelte-kit', '.ceng/tmp', '.ceng/logs', '.ceng/backups', '.ceng/upgrade-conflicts'];
/** Temporaires et verrous du framework (écriture atomique interrompue) : jetables. */
const FRAMEWORK_DISPOSABLE = /(^|\/)\.ceng\/brain\/[^/]*\.(tmp|lock)$/;

export interface Deletion {
  targets: string[];
  recursive: boolean;
}

const DELETE_COMMANDS = /^(rm|unlink|rmdir|rd|del|erase|Remove-Item|ri)$/i;

/**
 * Reconnaît une suppression de fichiers et en extrait les cibles (rm, unlink, rmdir, del, Remove-Item, git rm).
 * Renvoie null si le segment n'est pas une suppression.
 */
export function parseDeletion(segment: string): Deletion | null {
  const tokens = shellWords(segment, { dropRedirects: true }).filter(Boolean);
  let args: string[];
  if (tokens[0] === 'git' && tokens[1] === 'rm') args = tokens.slice(2);
  else if (tokens[0] && DELETE_COMMANDS.test(tokens[0])) args = tokens.slice(1);
  else return null;
  const flags = args.filter((a) => a.startsWith('-') || /^\/[a-z]$/i.test(a));
  const recursive = flags.some((f) => /^-[a-zA-Z]*r/i.test(f) || /^-recurse$/i.test(f) || /^\/s$/i.test(f)) || /^(rmdir|rd)$/i.test(tokens[0]!);
  const targets = args.filter((a) => !flags.includes(a) && !/^-(path|literalpath)$/i.test(a));
  return targets.length ? { targets, recursive } : null;
}

export function isRegenerablePath(target: string): boolean {
  const clean = normalizePath(target).replace(/\/$/, '');
  if (FRAMEWORK_DISPOSABLE.test(clean)) return true;
  return REGENERABLE_DIRS.some((d) => clean === d || clean.endsWith(`/${d}`) || clean.includes(`/${d}/`) || clean.startsWith(`${d}/`));
}

/** Destination du `git push` dont `argsText` est la fin de la ligne (après le mot `push`). */
function protectedPush(argsText: string, protectedBranches: readonly string[]): boolean {
  const args = shellWords(argsText).filter((a) => a && !a.startsWith('-'));
  // git push <remote> <refspec>
  const refspec = args[1];
  if (!refspec) return false;
  const dst = refspec.includes(':') ? refspec.split(':')[1]! : refspec;
  return protectedBranches.includes(dst.replace(/^refs\/heads\//, ''));
}

export interface CommandContext {
  autonomy: Autonomy;
  protectedBranches: readonly string[];
  /** Fichiers de secrets explicitement autorisés par l'humain (`ceng secrets allow`). */
  allowedSecrets?: readonly string[];
  /** Syntaxe de la commande (guillemets, échappements) : `powershell` pour l'outil du même nom. */
  shell?: ShellKind;
  /** Stade du projet (défaut : production). En `prototype`, les actions récupérables passent sans validation. */
  stage?: Stage;
  /** Le dépôt a un remote (autres développeurs ou déploiements en dépendent). Défaut : oui. */
  sharedRepo?: boolean;
  /** Racine du projet et répertoire courant de la commande : une suppression hors du projet est irrécupérable. */
  projectRoot?: string;
  cwd?: string;
  /** Branche courante (un `git push --force` sans destination la vise). */
  currentBranch?: string;
}

/**
 * Stade `prototype` : règles que l'on laisse passer parce que l'erreur est récupérable et ne coûte rien (aucun utilisateur
 * réel) — migrations, déploiements, push, historique local, fichiers de garde-fous. Restent soumis à validation : secrets,
 * suppression hors du dépôt, push forcé sur une branche protégée d'un dépôt partagé, et ce qui sort du projet
 * (publication, infrastructure, GitHub, processus).
 */
const PROTOTYPE_FREE = new Set(['deploy', 'db-destructive', 'prod-migrate', 'git-discard', 'git-history-rewrite', 'git-push-supervised', 'git-push-protected', 'config-apply']);

/** Un `git push --force` peut-il écraser l'historique d'une branche protégée d'un dépôt partagé ? (dans le doute : oui) */
function forcePushRisky(unit: Statement, ctx: CommandContext): boolean {
  if (ctx.sharedRepo === false) return false;
  const m = /\bgit\s+push\b/.exec(unit.live);
  if (!m) return true;
  const words = shellWords(unit.plain.slice(m.index + m[0].length));
  if (words.some((w) => /^--(all|mirror|delete|prune)$/.test(w))) return true;
  const refspecs = words.filter((w) => !w.startsWith('-')).slice(1);
  const targets = refspecs.length ? refspecs : [ctx.currentBranch ?? ''];
  return targets.some((r) => {
    let dst = (r.includes(':') ? r.split(':')[1]! : r).replace(/^\+/, '').replace(/^refs\/heads\//, '');
    if (dst === 'HEAD') dst = ctx.currentBranch ?? '';
    return dst === '' || ctx.protectedBranches.includes(dst);
  });
}

/** La cible d'une suppression est-elle hors du projet (ou non résoluble : variable, `~`) ? Aucun instantané ne peut la rattraper. */
function outsideProject(target: string, root: string, cwd?: string): boolean {
  if (/^~|^\$|^%|\$\(|`/.test(target)) return true;
  const rel = path.relative(root, path.resolve(cwd ?? root, target));
  return rel.startsWith('..') || path.isAbsolute(rel);
}

const SECRET_READERS = /^(cat|less|more|head|tail|type|Get-Content|gc|bat|xxd|od|strings|base64|cp|copy|scp|rsync|Copy-Item|sed|awk|grep|rg|nl|tac)$/i;

/** Lecture/copie d'un fichier de secrets (exceptions : .env.example & co). Un texte entre guillemets avec espaces n'est pas un chemin. */
function readsSecretFile(segment: string, allowed: readonly string[] = []): boolean {
  const tokens = shellWords(segment);
  if (tokens.length < 2 || !SECRET_READERS.test(tokens[0]!)) return false;
  return tokens.slice(1).some((t) => !t.startsWith('-') && isSecretPath(t, allowed));
}

/** Sous-commandes de la CLI ceng qui sont des décisions humaines (autoriser des secrets, réécrire la configuration des gates). */
const CENG_HUMAN_RULES = new Set(['secrets-allow', 'config-apply', 'config-stage']);

function cengHumanDecision(unit: Statement): Rule | undefined {
  return APPROVAL.find((r) => CENG_HUMAN_RULES.has(r.id) && r.pattern.test(unit.live));
}

/** Première règle d'approbation applicable à une instruction (texte analysé : `live`, ou brut pour une règle `scanQuoted`). */
function matchApproval(s: Statement): Rule | undefined {
  return APPROVAL.find((r) => r.pattern.test(r.scanQuoted ? s.plain : s.live) && !(r.dryRunSafe && DRY_RUN.test(s.live)));
}

/**
 * Évalue TOUTES les instructions d'une commande composée et renvoie le verdict le plus restrictif :
 * interdit > approbation > suppression (approbation levable par instantané) > autonome.
 * Les règles analysent ce qui est exécuté, pas les données passées en argument (message de commit, `--evidence "…"`) ;
 * les commandes de la CLI ceng ne sont jamais bloquées (hors autorisation de secrets, décision humaine).
 */
export function classifyCommand(command: string, ctx: CommandContext): Verdict {
  const whole = command.trim();
  const parsed = parseCommand(whole, ctx.shell ?? 'bash');
  const forbidden = (r: Rule): Verdict => ({ class: 'forbidden', reason: r.reason, rule: r.id });
  for (const r of FORBIDDEN) if (r.pattern.test(r.scanQuoted ? whole : parsed.wholeLive)) return forbidden(r);
  const approvals: Verdict[] = [];
  const deletions: Deletion[] = [];
  const freed: string[] = [];
  const prototype = ctx.stage === 'prototype';
  /** Demande une approbation, sauf si le stade prototype laisse passer cette règle. */
  const flag = (id: string, reason: string, unit: Statement): void => {
    if (prototype && (PROTOTYPE_FREE.has(id) || (id === 'git-force-push' && !forcePushRisky(unit, ctx)))) freed.push(id);
    else approvals.push({ class: 'approval', reason, rule: id });
  };
  for (const statement of parsed.statements) {
    for (const r of FORBIDDEN) if (r.pattern.test(r.scanQuoted ? statement.plain : statement.live)) return forbidden(r);
    // Chaque maillon d'un pipeline est évalué à part : une commande ceng n'exempte pas ce qu'on lui enchaîne.
    for (const unit of splitPipes(statement, ctx.shell)) {
      if (!unit.carriesCode && isCengCli(shellWords(unit.plain))) {
        const human = cengHumanDecision(unit);
        if (human) flag(human.id, human.reason, unit);
        continue;
      }
      if (readsSecretFile(unit.plain, ctx.allowedSecrets)) return { class: 'forbidden', reason: "Lecture ou copie d'un fichier de secrets.", rule: 'read-secrets' };
      const deletion = parseDeletion(unit.plain);
      if (deletion) {
        const remaining = deletion.targets.filter((t) => !isRegenerablePath(t));
        if (remaining.some((t) => isSecretPath(t, ctx.allowedSecrets))) approvals.push({ class: 'approval', reason: 'Suppression d\'un fichier de secrets (non sauvegardable).', rule: 'delete-secret' });
        else if (prototype && ctx.projectRoot && deletion.targets.some((t) => outsideProject(t, ctx.projectRoot!, ctx.cwd))) approvals.push({ class: 'approval', reason: 'Suppression hors du dépôt : irrécupérable (aucun instantané possible).', rule: 'delete-outside' });
        else if (remaining.length) deletions.push({ targets: remaining, recursive: deletion.recursive });
        continue;
      }
      const rule = matchApproval(unit);
      if (rule) flag(rule.id, rule.reason, unit);
      const push = /\bgit\s+push\b/.exec(unit.live);
      if (push) {
        if (ctx.autonomy === 'supervised') flag('git-push-supervised', 'Autonomie supervisée : tout push est validé par un humain.', unit);
        else if (protectedPush(unit.plain.slice(push.index + push[0].length), ctx.protectedBranches)) flag('git-push-protected', 'Push direct sur une branche protégée.', unit);
      }
    }
  }
  if (approvals.length) return approvals[0]!;
  if (deletions.length) {
    return {
      class: 'approval',
      reason: 'Suppression de fichiers : autorisée automatiquement si un instantané peut la rendre récupérable.',
      rule: 'delete',
      deletion: { targets: deletions.flatMap((d) => d.targets), recursive: deletions.some((d) => d.recursive) },
      ...(freed.length ? { freed: [...new Set(freed)] } : {}),
    };
  }
  return freed.length
    ? { class: 'autonomous', reason: 'Stade prototype : action récupérable, sans validation.', rule: 'prototype', freed: [...new Set(freed)] }
    : { class: 'autonomous', reason: 'Aucune règle de risque ne s\'applique.' };
}

// ---------------------------------------------------------------- Déclencheurs d'approbation

export interface Trigger {
  /** Texte de la sous-commande (maillon de pipeline) qui déclenche la règle. */
  text: string;
  rule: string;
}

/**
 * Sous-commandes qui déclenchent une règle d'approbation (ou une suppression), sans le contexte d'affichage
 * (`cd …`, `| tail`, redirections). Sert à identifier l'ACTION validée par l'humain : tout ce qui est à risque dans
 * la commande est listé, pour qu'une validation ne couvre jamais une sous-commande à risque ajoutée après coup.
 * Évaluation indépendante du contexte (autonomie, branches protégées) : une clé d'action doit rester stable.
 */
export function approvalTriggers(command: string, shell: ShellKind = 'bash'): Trigger[] {
  const out: Trigger[] = [];
  for (const statement of parseCommand(command.trim(), shell).statements) {
    for (const unit of splitPipes(statement, shell)) {
      if (!unit.carriesCode && isCengCli(shellWords(unit.plain))) {
        const human = cengHumanDecision(unit);
        if (human) out.push({ text: unit.plain, rule: human.id });
        continue;
      }
      if (parseDeletion(unit.plain)) {
        out.push({ text: unit.plain, rule: 'delete' });
        continue;
      }
      const rule = matchApproval(unit);
      if (rule) out.push({ text: unit.plain, rule: rule.id });
      else if (/\bgit\s+push\b/.test(unit.live)) out.push({ text: unit.plain, rule: 'git-push' });
    }
  }
  return out;
}

/** Règles dont l'autorisation ne vaut jamais pour une seconde exécution (destruction, réécriture, décision de sécurité). */
const SINGLE_USE_RULES = new Set(['delete', 'delete-outside', 'config-stage', 'git-discard', 'git-force-push', 'git-history-rewrite', 'gh-destructive', 'secrets-allow', 'secrets-mgmt', 'config-apply', 'kill-all']);
/** Mots qui signalent une opération destructive de données ou d'infrastructure, quelle que soit la règle qui l'a déclenchée. */
const DESTRUCTIVE_WORDS = /\b(drop|truncate|delete|destroy|uninstall|reset|flush|downgrade|purge|rollback|undo|wipe)\b|--force-reset/i;

/**
 * L'autorisation de cette commande est-elle à usage unique ? Oui pour une opération destructive (DROP/TRUNCATE/DELETE,
 * reset, suppression, réécriture d'historique…) ; non pour un déploiement ou une migration, qu'on doit pouvoir relancer
 * après une erreur pendant la durée de l'autorisation.
 */
export function isSingleUseCommand(command: string, shell: ShellKind = 'bash'): boolean {
  const triggers = approvalTriggers(command, shell);
  if (triggers.length) return triggers.some((t) => SINGLE_USE_RULES.has(t.rule) || DESTRUCTIVE_WORDS.test(t.text));
  // Aucune règle ne s'applique (autorisation demandée par la boîte native) : même prudence sur le texte lui-même.
  return parseCommand(command.trim(), shell).statements.some((s) => splitPipes(s, shell).some((u) => parseDeletion(u.plain) !== null || DESTRUCTIVE_WORDS.test(u.live)));
}

// ---------------------------------------------------------------- Fichiers

const SECRET_FILES = ['**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/id_rsa*', '**/id_ed25519*', '**/.npmrc', '**/.pypirc', '**/credentials.json', '**/service-account*.json', '**/*.p12', '**/*.keystore', '**/*.jks'];
const SECRET_FILE_EXCEPTIONS = ['**/.env.example', '**/.env.sample', '**/.env.template', '**/.env.dist', '**/*.example.key'];
const GIT_INTERNALS = ['.git/**'];
/** Fichiers dont la modification change les garde-fous eux-mêmes ou la gouvernance du projet. */
const GOVERNANCE_FILES = [
  '.claude/settings.json', '.claude/settings.local.json', '.ceng/config.json', '.ceng/runtime/**',
  'LICENSE', 'LICENSE.*', 'LICENCE', 'COPYING', 'CODEOWNERS', '.github/CODEOWNERS', 'SECURITY.md',
];
const CI_FILES = ['.github/workflows/**', '.gitlab-ci.yml', '.circleci/**', 'azure-pipelines.yml', 'Jenkinsfile', 'bitbucket-pipelines.yml'];
const INFRA_FILES = ['**/*.tf', '**/*.tfvars', 'k8s/**', 'kubernetes/**', 'helm/**', '**/Chart.yaml'];

export function classifyFileWrite(path: string, autonomy: Autonomy, allowedSecrets: readonly string[] = [], stage: Stage = 'production'): Verdict {
  /** Stade prototype : fichiers de garde-fous, CI et infra se modifient sans validation (journalisé). */
  const freeInPrototype = (rule: string): Verdict => ({ class: 'autonomous', reason: 'Stade prototype : modification libre.', rule: 'prototype', freed: [rule] });
  const p = normalizePath(path);
  if (matchesAny(p, GIT_INTERNALS)) return { class: 'forbidden', reason: 'Modification directe des internes git.', rule: 'git-internals' };
  if (isSecretPath(p, allowedSecrets)) return { class: 'forbidden', reason: 'Fichier de secrets : jamais écrit par un agent.', rule: 'secret-file' };
  if (matchesAny(p, GOVERNANCE_FILES)) return stage === 'prototype' ? freeInPrototype('governance-file') : { class: 'approval', reason: 'Fichier de gouvernance/garde-fous ou de licence : validation humaine.', rule: 'governance-file' };
  if (matchesAny(p, CI_FILES) && autonomy !== 'high') return stage === 'prototype' ? freeInPrototype('ci-file') : { class: 'approval', reason: 'Pipeline CI/CD : impact sur la chaîne de livraison.', rule: 'ci-file' };
  if (matchesAny(p, INFRA_FILES) && autonomy !== 'high') return stage === 'prototype' ? freeInPrototype('infra-file') : { class: 'approval', reason: 'Définition d\'infrastructure.', rule: 'infra-file' };
  return { class: 'autonomous', reason: 'Fichier de travail ordinaire.' };
}

/** Fichier de secrets, sauf exemples (.env.example…) et fichiers explicitement autorisés par l'humain. */
export function isSecretPath(path: string, allowed: readonly string[] = []): boolean {
  const p = normalizePath(path);
  if (allowed.length && matchesAny(p, allowed.map(normalizePath))) return false;
  return matchesAny(p, SECRET_FILES) && !matchesAny(p, SECRET_FILE_EXCEPTIONS);
}

/** Lecture d'un fichier par l'outil Read de Claude Code (garde utilisée quand des secrets sont autorisés). */
export function classifyFileRead(path: string, allowedSecrets: readonly string[] = []): Verdict {
  return isSecretPath(path, allowedSecrets)
    ? { class: 'forbidden', reason: 'Fichier de secrets non autorisé (seuls les fichiers autorisés par l\'humain via `ceng secrets allow` sont lisibles).', rule: 'read-secrets' }
    : { class: 'autonomous', reason: 'Lecture ordinaire.' };
}

/** Tableau lisible des catégories, injecté dans le contexte et la documentation. */
export const APPROVAL_SUMMARY = [
  'Déploiement / publication / release',
  'Changements d\'infrastructure (terraform, kubectl, helm, cloud)',
  'Opérations destructives : push forcé, reset --hard, suppression récursive, données (DROP/TRUNCATE/reset)',
  'Migrations ciblant la production',
  'Secrets (création, rotation) et fichiers de garde-fous (.claude/settings*, .ceng/config.json)',
  'Licence, CODEOWNERS, SECURITY.md, ajout de dépendance copyleft, nouvelle collecte de données personnelles',
];
