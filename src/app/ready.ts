import * as path from 'node:path';
import { dataMapProblems } from './data-map.js';
import { applies, missingMechanisms } from './compliance.js';
import { listDecisions } from './decisions.js';
import { runSecretsGate } from './gates.js';
import { currentDeps } from './deps.js';
import { exists, listFiles, readText } from '../infra/fs.js';
import { runShell } from '../infra/exec.js';
import type { BrainStore } from '../brain/store.js';

/**
 * `ceng ready` : contrôles mécaniques « prêt pour la production ». Chacun est court et sans jeton ; un contrôle peut être levé
 * durablement par une décision dont le texte contient `ready:<id>` (le choix reste tracé, il n'est pas redemandé).
 */

export interface ReadyCheck {
  id: string;
  title: string;
  status: 'pass' | 'fail' | 'skipped';
  detail: string;
  fix?: string;
}

const CODE = /\.(ts|tsx|js|jsx|mjs|py|go|rs|dart|kt|java|swift|php|rb)$/i;
const MAX_BYTES = 256_000;
const IGNORED_ENV = new Set(['NODE_ENV', 'CI', 'PATH', 'HOME', 'USER', 'PWD', 'PORT', 'TZ', 'LANG', 'TEMP', 'TMP', 'DEBUG', 'HOSTNAME', 'SHELL']);

interface Scan {
  root: string;
  files: string[];
  code: string[];
  text: (f: string) => string;
}

function scan(root: string): Scan {
  const files = listFiles(root, { maxFiles: 20000 }).files;
  const cache = new Map<string, string>();
  const text = (f: string) => {
    if (!cache.has(f)) {
      const t = readText(path.join(root, f));
      cache.set(f, t && t.length < MAX_BYTES ? t : '');
    }
    return cache.get(f)!;
  };
  return { root, files, code: files.filter((f) => CODE.test(f) && !/(^|\/)(test|tests|__tests__|node_modules|dist|build)\//.test(f) && !/\.(test|spec)\./.test(f)), text };
}

function envVariables(s: Scan): Map<string, string> {
  const found = new Map<string, string>();
  const patterns = [/process\.env\.([A-Z][A-Z0-9_]+)/g, /process\.env\[['"]([A-Z][A-Z0-9_]+)['"]\]/g, /Deno\.env\.get\(['"]([A-Z][A-Z0-9_]+)['"]\)/g, /os\.environ(?:\.get)?[[(]['"]([A-Z][A-Z0-9_]+)['"]/g, /os\.getenv\(['"]([A-Z][A-Z0-9_]+)['"]/g, /String\.fromEnvironment\(\s*['"]([A-Z][A-Z0-9_]+)['"]/g];
  for (const f of s.code) for (const re of patterns) for (const m of s.text(f).matchAll(re)) if (!IGNORED_ENV.has(m[1]!) && !m[1]!.startsWith('CENG_')) found.set(m[1]!, f);
  return found;
}

const LOCKS: Record<string, string[]> = { 'package.json': ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock'], 'pubspec.yaml': ['pubspec.lock'], 'Cargo.toml': ['Cargo.lock'], 'pyproject.toml': ['poetry.lock', 'uv.lock', 'Pipfile.lock', 'requirements.txt'] };
const ERROR_TRACKERS = /^(@sentry\/|sentry|bugsnag|@bugsnag|rollbar|firebase_crashlytics|sentry_flutter|@datadog|dd-trace|newrelic|honeybadger|@highlight)/i;

export function runChecks(store: BrainStore): ReadyCheck[] {
  const root = store.paths.root;
  const s = scan(root);
  const decisions = listDecisions(store);
  const waived = (id: string) => decisions.find((d) => d.text.includes(`ready:${id}`));
  const profile = store.profile();
  const checks: ReadyCheck[] = [];
  const add = (id: string, title: string, status: ReadyCheck['status'], detail: string, fix?: string) => {
    const w = status === 'fail' ? waived(id) : undefined;
    checks.push(w ? { id, title, status: 'skipped', detail: `écarté par la décision ${w.file}` } : { id, title, status, detail, ...(fix ? { fix } : {}) });
  };

  // Variables d'environnement documentées
  const vars = envVariables(s);
  const example = s.files.find((f) => /(^|\/)\.env\.example$/.test(f));
  if (!vars.size) add('env', 'Variables d\'environnement documentées', 'skipped', 'aucune variable lue dans le code');
  else {
    const documented = new Set([...s.text(example ?? '').matchAll(/^\s*([A-Z][A-Z0-9_]+)\s*=/gm)].map((m) => m[1]!));
    const missing = [...vars.keys()].filter((v) => !documented.has(v));
    add('env', "Variables d'environnement documentées", missing.length ? 'fail' : 'pass', missing.length ? `absentes de .env.example : ${missing.slice(0, 8).join(', ')}` : `${vars.size} variable(s) documentée(s)`, 'ajouter chaque nom (sans valeur) dans .env.example, avec un commentaire');
  }

  // Secrets suivis par git, dépôt entier
  const secrets = runSecretsGate(root, s.files.filter((f) => !/(^|\/)(node_modules|dist|build)\//.test(f)).slice(0, 8000));
  add('secrets', 'Aucun secret dans le dépôt', secrets.status === 'pass' ? 'pass' : 'fail', secrets.detail.split('\n').slice(0, 4).join(' | '), 'retirer le secret, le faire tourner, le charger depuis l\'environnement');

  // Migrations rejouables
  const migrate = store.config().commands.migration;
  if (!migrate) add('migrations', 'Migrations rejouables', 'skipped', 'aucune commande `migration` configurée');
  else {
    const r = runShell(migrate, { cwd: root, timeoutMs: 10 * 60_000 });
    add('migrations', 'Migrations rejouables', r.code === 0 ? 'pass' : 'fail', `${migrate} → exit ${r.code}`, 'corriger la migration ou la commande `migration` (.ceng/config.json)');
  }

  // TODO orphelins
  const orphans = s.code.flatMap((f) => s.text(f).split(/\r?\n/).map((l, i) => ({ f, i, l })).filter((x) => /\b(TODO|FIXME|XXX)\b(?!.*T-\d{4})/.test(x.l)).map((x) => `${x.f}:${x.i + 1}`));
  add('todo', 'Aucun TODO sans tâche', orphans.length ? 'fail' : 'pass', orphans.length ? `${orphans.length} : ${orphans.slice(0, 5).join(', ')}` : 'aucun', 'créer la tâche (T-xxxx) ou supprimer le TODO');

  // Verrou de dépendances
  const manifests = s.files.filter((f) => path.posix.basename(f) in LOCKS && f.split('/').length <= 3);
  const noLock = manifests.filter((m) => !LOCKS[path.posix.basename(m)]!.some((l) => exists(path.join(root, path.posix.dirname(m), l))));
  add('lockfile', 'Verrou de dépendances présent', noLock.length ? 'fail' : 'pass', noLock.length ? `manquant pour ${noLock.join(', ')}` : manifests.length ? 'présent' : 'sans objet', 'installer avec l\'outil du projet et versionner le fichier de verrou');

  // Suivi d'erreurs, point de santé, intégration continue
  const deps = currentDeps(root);
  const hasService = Boolean(profile?.projectTypes.includes('api') || profile?.projectTypes.includes('web-app') || profile?.projectTypes.includes('mobile'));
  if (hasService) {
    add('errors', 'Suivi des erreurs en production', deps.some((d) => ERROR_TRACKERS.test(d.name)) ? 'pass' : 'fail', deps.some((d) => ERROR_TRACKERS.test(d.name)) ? 'bibliothèque de suivi présente' : 'aucune bibliothèque de suivi d\'erreurs', 'ajouter un suivi (sans données personnelles) ou une décision contenant `ready:errors`');
  }
  if (profile?.projectTypes.includes('api')) {
    const health = s.code.some((f) => /\/(health|healthz|ready|status)\b|['"]\/?health/i.test(s.text(f)));
    add('health', 'Point de santé', health ? 'pass' : 'fail', health ? 'route de santé trouvée' : 'aucune route /health', 'ajouter une route de santé (ou une décision contenant `ready:health`)');
  }
  const ci = s.files.some((f) => /^\.github\/workflows\/|^\.gitlab-ci\.yml$|^\.circleci\/|^azure-pipelines\.yml$|^codemagic\.yaml$|^bitbucket-pipelines\.yml$/.test(f));
  add('ci', 'Intégration continue', ci ? 'pass' : 'fail', ci ? 'fichier de CI présent' : 'aucune CI', 'ajouter la CI (build, tests, audit) ou une décision contenant `ready:ci`');

  // Exigences du cahier des charges couvertes
  const spec = readText(path.join(store.paths.brain, 'spec.md'));
  if (spec) {
    const ids = [...new Set([...spec.matchAll(/\bEX-\d{3,}\b/g)].map((m) => m[0]))];
    const covered = new Set(store.tasks().filter((t) => t.status !== 'cancelled').flatMap((t) => t.spec ?? []));
    const open = ids.filter((i) => !covered.has(i));
    add('spec', 'Exigences du cahier des charges couvertes', open.length ? 'fail' : 'pass', open.length ? `sans tâche : ${open.slice(0, 8).join(', ')}` : `${ids.length} exigence(s) rattachée(s)`, 'task add --spec EX-xxx pour chacune (ou la retirer du cahier par une décision)');
  }

  // Décisions à impact fort en attente
  const pending = decisions.filter((d) => /EN ATTENTE/i.test(d.text.slice(0, 400)) && /impact d'un changement : fort/i.test(d.text.slice(0, 400)));
  add('decisions', 'Aucune décision forte en attente', pending.length ? 'fail' : 'pass', pending.length ? pending.map((d) => d.title).join(' ; ') : 'aucune', 'poser la question à l\'humain (invite) puis `decision add`');

  // Conformité et sécurité (socle)
  const regulated = applies(store);
  const missing = missingMechanisms(store);
  if (regulated) add('compliance', 'Socle de conformité', missing.length ? 'fail' : 'pass', missing.length ? `${missing.length} manquant(s) : ${missing.slice(0, 6).map((m) => m.mechanism.id).join(', ')}` : 'complet', '`ceng compliance status` puis construire ou écarter (décision de l\'humain)');
  const unclassified = dataMapProblems(root);
  if (unclassified.length) add('data-map', 'Carte des données à jour', 'fail', `${unclassified.length} colonne(s) non classée(s) : ${unclassified[0]}`, '`ceng data-map` après avoir classé les colonnes (commentaires SQL)');
  const clientLeak = s.code.filter((f) => /(^|\/)(lib|web|client|public|app)\//.test(f) && /(SERVICE_ROLE|sb_secret_|SUPABASE_SECRET_KEY)/.test(s.text(f)) && !/(^|\/)(supabase\/functions|server|api|functions)\//.test(f));
  add('client-keys', "Clé d'administration absente du code client", clientLeak.length ? 'fail' : 'pass', clientLeak.length ? clientLeak.slice(0, 4).join(', ') : 'aucune', 'la clé secrète ne vit que côté serveur (fonction, API)');
  if (regulated) {
    const legal = s.files.some((f) => /^\.ceng\/brain\/research\/legal-/.test(f)) || exists(path.join(store.paths.research, 'legal.md'));
    add('legal-research', 'Cadrage légal fait', legal ? 'pass' : 'fail', legal ? 'recherche légale présente' : 'aucune recherche légale par pays', 'ceng-researcher : lire les textes officiels des pays visés → research/legal-<pays>.md');
    const pages = (re: RegExp) => s.files.some((f) => re.test(f.toLowerCase()));
    const ok = pages(/privacy|confidentialit/) && pages(/terms|conditions|cgu|cgv/);
    add('legal-pages', 'Pages légales (confidentialité, conditions)', ok ? 'pass' : 'fail', ok ? 'présentes' : 'confidentialité ou conditions introuvables', 'créer les pages accessibles sans compte, reliées aux versions de politique (C-01)');
    const restore = decisions.some((d) => /restauration test/i.test(d.text)) || store.listDir(store.paths.reports).some((f) => /restauration test/i.test(readText(path.join(store.paths.reports, f)) ?? ''));
    add('backup-restore', 'Restauration de sauvegarde testée', restore ? 'pass' : 'fail', restore ? 'attestée' : 'aucune attestation', 'tester une restauration puis la consigner (rapport ou décision « restauration testée »)');
  }
  return checks;
}

export function runReady(store: BrainStore): { ok: boolean; summary: string; checks: ReadyCheck[] } {
  const checks = runChecks(store);
  const failed = checks.filter((c) => c.status === 'fail');
  return {
    ok: failed.length === 0,
    checks,
    summary: failed.length ? `${failed.length} contrôle(s) en échec : ${failed.map((c) => `${c.id} (${c.detail})`).join(' ; ')}`.slice(0, 1800) : `${checks.filter((c) => c.status === 'pass').length} contrôle(s) verts, ${checks.filter((c) => c.status === 'skipped').length} sans objet ou écartés.`,
  };
}
