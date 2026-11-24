import * as fs from 'node:fs';
import { readVetted, unvettedDeps } from '../app/deps.js';
import { logAnswers } from '../app/answers-log.js';
import { listRules } from '../app/rules.js';
import { recall, renderRecall } from '../app/recall.js';
import { tokenize } from '../domain/similarity.js';
import { isManifest } from '../domain/deps.js';
import * as os from 'node:os';
import * as path from 'node:path';
import { classifyCommand, classifyFileRead, classifyFileWrite, isSingleUseCommand, parseDeletion, splitCommand, type CommandContext } from '../domain/guardrails.js';
import type { ShellKind } from '../domain/shell.js';
import { Git } from '../infra/git.js';
import { autoApproveDeletion } from '../app/deletion.js';
import { deferredReason, isUnattended, recordPendingApproval, shouldKeepWorking } from '../app/unattended.js';
import { PRESENCE_WINDOW_MS, isHumanAway, markAutopilot, markHumanActive, markHumanAnswered, markHumanAway, presenceEnabled } from '../app/presence.js';
import { actionKey, answerFeedback, applyAnswers, askViaInvite, clearRefusals, consumeGrant, consumeHandoff, findRefusal, openRequest, refusedMessage, shellOf } from '../app/approvals.js';
import { isTimeout } from '../domain/answers.js';
import { readJson, readText, removeOrphanTemps } from '../infra/fs.js';
import { matchesAny, normalizePath } from '../domain/globs.js';
import { resumeBrief } from '../brain/brief.js';
import type { BrainStore, CheckpointRecord } from '../brain/store.js';
import { createCheckpoint } from '../app/checkpoints.js';
import { completionCheck } from '../app/tasks.js';
import { CLI_INVOCATION } from '../brain/paths.js';
import { currentDelegation } from '../app/delegation.js';
import { graphDisabledByEnv, graphifyAvailable, refreshIfNeeded } from '../app/codegraph.js';
import { classifyTeamTool } from '../domain/team.js';
import { mainRoot } from '../app/relay.js';
import { checkCode, DEFAULT_LIMITS, formatFindings } from '../domain/code-check.js';
import { frameworkCli, frameworkFingerprint, readRegistry, upgradeInBackground } from '../app/registry.js';
import { closeIntent, externalEffects, openIntent, unresolvedIntents } from '../app/intents.js';

/**
 * Gestionnaires de hooks Claude Code. Chaque gestionnaire reçoit l'entrée JSON du hook et renvoie
 * une sortie JSON (ou rien) + un code de sortie. Ils doivent être rapides et ne jamais casser la session.
 */

export interface HookInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  source?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  agent_id?: string;
  agent_type?: string;
  stop_hook_active?: boolean;
  last_assistant_message?: string;
  trigger?: string;
  [k: string]: unknown;
}

export interface HookOutput {
  json?: Record<string, unknown>;
  /** Texte brut sur la sortie standard (PreCompact : instructions pour le résumé de compaction). */
  stdout?: string;
  stderr?: string;
  exitCode: number;
}

const OK: HookOutput = { exitCode: 0 };
const TASK_ID = /\bT-\d{4}\b/;
const REPORT_MARKER = 'CENG_REPORT';
const SPAWN_MATCH_WINDOW_MS = 10 * 60_000;

/**
 * Demande d'approbation humaine, toujours par l'invite de questions (qui peut expirer) :
 *  - autorisation déjà donnée par l'humain pour cette même action -> autorisée (30 min, relances comprises ; usage unique
 *    pour une opération destructive : `once`) ;
 *  - action refusée par l'humain -> bloquée sans reposer la question (jusqu'à son prochain message) ;
 *  - humain absent (invite expirée, mode nuit) -> refus propre, consigné pour son retour ; Claude continue ;
 *  - sinon -> refus avec la consigne de poser la question via AskUserQuestion (identifiant unique R-xxxx).
 * Bascule désactivable (`presence.enabled: false`) : on retombe alors sur la boîte de permission native.
 */
/** Mode équipe autonome : le framework tranche à la place d'un humain absent. */
const teamOn = (store: BrainStore): boolean => store.config().team?.enabled === true;
/** Bypass total (décision humaine, `ceng bypass on`) : plus aucune validation ni refus ; journal et instantanés conservés. */
const bypassOn = (store: BrainStore): boolean => store.config().bypass?.enabled === true;

function allowDecision(reason: string): HookOutput {
  return { exitCode: 0, json: { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: `[ceng] ${reason}` } } };
}

function askHuman(store: BrainStore, input: HookInput, what: string, reason: string, once: boolean): HookOutput {
  const key = actionKey(String(input.tool_name ?? ''), input.tool_input);
  const grant = consumeGrant(store, key);
  if (grant) {
    store.log({ type: 'guard.verdict', ...ids(input), data: { class: 'approved-by-human', request: grant.requestId } });
    return { exitCode: 0, json: { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: `[ceng] Approuvé par l'humain (${grant.requestId}), autorisation consommée.` } } };
  }
  const refusal = findRefusal(store, key);
  if (refusal) return preToolDecision('deny', refusedMessage(refusal));
  // Équipe autonome : jamais d'attente. Ce qui exige l'humain est refusé proprement et consigné pour son retour.
  if (teamOn(store)) {
    recordPendingApproval(store, what, reason);
    return preToolDecision('deny', deferredReason(reason));
  }
  if (isHumanAway(store)) {
    recordPendingApproval(store, what, reason);
    return preToolDecision('deny', deferredReason(reason));
  }
  if (!presenceEnabled(store)) return preToolDecision('ask', reason);
  return preToolDecision('deny', askViaInvite(openRequest(store, key, what, reason, once)));
}

/** Stade du projet (défaut : production — garde-fous complets). */
const stageOf = (store: BrainStore) => store.config().stage ?? 'production';

/**
 * Contexte de classification d'une commande. Au stade prototype, il dit si le dépôt est partagé (un remote existe) et sur quelle
 * branche on est (pour un push forcé) ; ces lectures git ne sont faites que dans ce cas.
 */
function commandContext(store: BrainStore, input: HookInput, command: string, shell: ShellKind): CommandContext {
  const config = store.config();
  const protectedBranches = [...(store.profile()?.git.protectedBranches ?? ['main', 'master'])];
  const ctx: CommandContext = { autonomy: config.policy.autonomy, protectedBranches, allowedSecrets: config.secrets?.allow ?? [], shell, stage: config.stage ?? 'production', projectRoot: store.paths.root, ...(input.cwd ? { cwd: input.cwd } : {}) };
  if (ctx.stage === 'prototype' && /\bpush\b/.test(command)) {
    const git = new Git(store.paths.root);
    const defaultBranch = git.defaultBranch();
    if (defaultBranch && !protectedBranches.includes(defaultBranch)) protectedBranches.push(defaultBranch);
    const branch = git.currentBranch();
    return { ...ctx, sharedRepo: git.remotes().length > 0, ...(branch ? { currentBranch: branch } : {}) };
  }
  return ctx;
}

/** Règles dont la perte de travail local est rattrapée par un instantané pris juste avant (stade prototype). */
const SNAPSHOT_BEFORE = new Set(['git-discard', 'git-history-rewrite']);

/**
 * Stade prototype : l'action aurait demandé une validation, elle passe. Elle est journalisée, et un instantané (annulable par
 * `ceng rollback`) est pris avant ce qui peut détruire du travail local.
 */
function allowInPrototype(store: BrainStore, input: HookInput, freed: readonly string[], what: string): HookOutput {
  let snapshot = '';
  if (freed.some((f) => SNAPSHOT_BEFORE.has(f))) {
    try {
      const state = store.state();
      const cp = createCheckpoint(store, { done: `Instantané automatique avant ${freed.join(', ')} (stade prototype) : ${what}`.slice(0, 300), next: state.lastCheckpoint?.next ?? 'continuer la tâche en cours', auto: true });
      if (cp.snapshot) snapshot = ` Instantané ${cp.id} pris avant (annulable : \`${CLI_INVOCATION} rollback ${cp.id} --apply\`).`;
    } catch {
      // l'instantané est un filet : son échec ne bloque pas un prototype
    }
  }
  store.log({ type: 'guard.verdict', ...ids(input), data: { tool: input.tool_name, class: 'autonomous', rule: 'prototype', freed: [...freed] } });
  const note = `[ceng] Stade prototype : ${freed.join(', ')} sans validation (journalisé).${snapshot}`;
  return { exitCode: 0, json: { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: note } } };
}

/**
 * Bypass total : l'action passe, quelle que soit la règle (interdiction comprise : c'est le choix de l'humain). Elle est journalisée,
 * et un instantané est pris avant ce qui peut détruire du travail local (suppression, reset, réécriture) : tout reste annulable.
 */
function allowInBypass(store: BrainStore, input: HookInput, what: string, rule: string | undefined, deletionTargets?: readonly string[]): HookOutput {
  let snapshot = '';
  try {
    if (deletionTargets?.length) {
      const check = autoApproveDeletion(store, [...deletionTargets], input.cwd);
      if (check.ok) snapshot = check.checkpointId ?? '';
    } else if (rule && SNAPSHOT_BEFORE.has(rule)) {
      const state = store.state();
      snapshot = createCheckpoint(store, { done: `Instantané automatique avant ${rule} (bypass) : ${what}`.slice(0, 300), next: state.lastCheckpoint?.next ?? 'continuer la tâche en cours', auto: true }).id;
    }
  } catch {
    // l'instantané est un filet : son échec ne bloque jamais en bypass
  }
  store.log({ type: 'guard.verdict', ...ids(input), data: { tool: input.tool_name, class: 'autonomous', rule: 'bypass', bypassed: rule ?? 'permission', ...(snapshot ? { checkpoint: snapshot } : {}) } });
  return allowDecision(`Bypass total : ${rule ?? 'action'} sans validation (journalisé).${snapshot ? ` Instantané ${snapshot} pris avant (annulable : \`${CLI_INVOCATION} rollback ${snapshot} --apply\`).` : ''}`);
}

function preToolDecision(decision: 'deny' | 'ask', reason: string): HookOutput {
  return {
    exitCode: 0,
    json: { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: `[ceng] ${reason}` } },
  };
}

function relativeToProject(store: BrainStore, file: string): string {
  const abs = path.isAbsolute(file) ? file : path.join(store.paths.root, file);
  return normalizePath(path.relative(store.paths.root, abs));
}

export function sessionStart(store: BrainStore, input: HookInput): HookOutput {
  const source = input.source ?? 'startup';
  store.updateState((s) => {
    s.sessions += 1;
    s.lastSessionAt = new Date().toISOString();
    s.pendingSpawns = [];
    // Nouveau processus : les sous-agents d'une session précédente n'existent plus (reprise/compaction : ils peuvent continuer).
    if (source === 'startup') {
      s.runningAgents = {};
      s.agentStartedAt = {};
      s.handbackReports = {};
      s.compactions = 0;
      s.contextWarnLevel = 0;
    }
  });
  removeOrphanTemps(store.paths.brain);
  store.log({ type: 'session.start', ...(input.session_id ? { sessionId: input.session_id } : {}), data: { source } });
  const brief = [resumeBrief(store, source), ...autoUpgrade(store), ...intentWarnings(store), ...stageNotes(store), ...machineWarnings(store)].join('\n');
  return { exitCode: 0, json: { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: brief } } };
}

const BYPASS_NOTE = `BYPASS TOTAL (décidé par l'humain) : aucune validation, aucun refus du framework — suppressions, push, déploiements, migrations, infrastructure, fichiers .env et garde-fous compris. N'attends aucune approbation et ne pose pas de question d'autorisation : agis. Secrets : utilise-les sans afficher leurs valeurs (noms de variables, \`${CLI_INVOCATION} secrets keys\`) ; lis-les si la tâche l'exige, sans jamais les recopier dans un rapport, un log ou un commit. Instantané automatique avant suppression/reset (annulable : \`${CLI_INVOCATION} rollback\`) ; checkpoint volontaire avant tout ce qui sort de la machine. Questions de direction : seulement si l'impact est fort, sinon ta recommandation devient la décision.`;

/**
 * Le framework de la machine est plus récent que la copie du projet : mise à jour lancée en arrière-plan (non destructive :
 * fichiers modifiés par l'utilisateur préservés). Ainsi aucun projet n'est à mettre à jour à la main.
 */
function autoUpgrade(store: BrainStore): string[] {
  if (process.env['CENG_NO_AUTO_UPGRADE'] === '1' || process.env['CENG_AUTO_UPGRADE_CHILD'] === '1') return [];
  try {
    if (store.config().autoUpgrade === false) return [];
    const fw = readRegistry().framework;
    if (!fw || path.resolve(fw) === path.resolve(store.paths.root)) return [];
    const cli = frameworkCli(fw);
    const build = cli ? frameworkFingerprint(fw) : undefined;
    const installed = readJson<{ frameworkBuild?: string }>(store.paths.manifest)?.frameworkBuild;
    if (!cli || !build || build === installed) return [];
    const last = store.state().autoUpgradeAt;
    if (last && Date.now() - Date.parse(last) < 10 * 60_000) return [];
    store.updateState((s) => {
      s.autoUpgradeAt = new Date().toISOString();
    });
    upgradeInBackground(cli, store.paths.root);
    store.log({ type: 'session.start', data: { autoUpgrade: true, from: installed ?? 'inconnu', to: build } });
    return ['Framework ceng mis à jour en arrière-plan (version plus récente sur cette machine) : nouvelles skills et nouveaux agents actifs à la prochaine session.'];
  } catch {
    return [];
  }
}

/** Actions à effet extérieur lancées sans résultat enregistré (session coupée) : vérifier l'état réel avant toute relance. */
function intentWarnings(store: BrainStore): string[] {
  const open = unresolvedIntents(store);
  if (!open.length) return [];
  return [
    `⚠ ${open.length} action(s) à effet extérieur lancée(s) sans résultat enregistré (session interrompue) — vérifier l'état RÉEL avant toute relance (déploiement en ligne ? migration appliquée ? paquet publié ? push présent sur le distant ?), ne jamais rejouer à l'aveugle :`,
    ...open.map((i) => `  - ${i.at.slice(0, 16).replace('T', ' ')} [${i.rules.join(', ')}] ${i.command.slice(0, 160)}`),
    "  Relancer seulement si elle n'a pas eu lieu (une relance qui aboutit clôt l'intention).",
  ];
}

/** Au stade prototype, l'orchestrateur doit savoir que les validations courantes sont levées (et ce qui reste soumis à l'humain). */
function stageNotes(store: BrainStore): string[] {
  if (bypassOn(store)) return [BYPASS_NOTE];
  if (stageOf(store) !== 'prototype') return [];
  return [`Stade : PROTOTYPE (aucun utilisateur réel) — migrations, déploiements, suppressions, push et fichiers de garde-fous passent sans validation (journalisé ; instantané avant suppression/reset, annulable par \`${CLI_INVOCATION} rollback\`). Restent soumis à l'humain : secrets, suppression hors du dépôt, push forcé sur une branche protégée d'un dépôt partagé, publication, infrastructure. Passage en production : \`${CLI_INVOCATION} config stage production\`.`];
}

/**
 * Ce qui manque sur CETTE machine (le dépôt peut avoir été cloné ailleurs) : signalé à chaque démarrage,
 * pour que Claude le règle sans dépendre d'une mémoire propre à un poste.
 */
function machineWarnings(store: BrainStore): string[] {
  const out: string[] = [];
  const config = store.config();
  if (config.codeGraph?.enabled && !graphDisabledByEnv() && !graphifyAvailable(store.paths.root)) {
    out.push(`⚠ Graphe de code activé mais graphify absent sur cette machine : proposer à l'humain \`${CLI_INVOCATION} graph install\` puis \`graph build\` (sinon, travailler avec grep).`);
  }
  return out;
}

/** Suppression que même le stade prototype ne laisse pas passer : hors du projet, internes git, mémoire du framework. */
const UNRECOVERABLE_DELETION = /hors du projet|racine du projet|: \.git(\/|$)|: \.ceng\/brain/;

/**
 * PreToolUse Bash/PowerShell : décision des garde-fous, puis, si l'action à effet extérieur n'est pas refusée, ouverture de son
 * intention (close par `commandDone` au retour du résultat).
 */
export function guardCommand(store: BrainStore, input: HookInput): HookOutput {
  const out = guardCommandDecision(store, input);
  const command = String(input.tool_input?.['command'] ?? '');
  const decision = (out.json?.['hookSpecificOutput'] as { permissionDecision?: string } | undefined)?.permissionDecision;
  if (command && out.exitCode === 0 && decision !== 'deny') {
    try {
      const rules = externalEffects(command, shellOf(String(input.tool_name ?? '')));
      if (rules.length) openIntent(store, command, rules, input.session_id);
    } catch {
      // le journal d'intention est un filet : il ne bloque jamais une commande
    }
  }
  return out;
}

/** PostToolUse Bash/PowerShell : le résultat est revenu, l'intention éventuelle est close (aucune écriture sinon). */
export function commandDone(store: BrainStore, input: HookInput): HookOutput {
  const command = String(input.tool_input?.['command'] ?? '');
  if (command) closeIntent(store, command, input.session_id);
  return OK;
}

function guardCommandDecision(store: BrainStore, input: HookInput): HookOutput {
  const command = String(input.tool_input?.['command'] ?? '');
  if (!command) return OK;
  const shell = shellOf(String(input.tool_name ?? ''));
  const verdict = classifyCommand(command, commandContext(store, input, command, shell));
  if (bypassOn(store) && verdict.class !== 'autonomous') return allowInBypass(store, input, command, verdict.rule, verdict.deletion?.targets);
  if (verdict.class === 'autonomous') return verdict.freed?.length ? allowInPrototype(store, input, verdict.freed, command) : OK;
  // Suppression de fichiers : pas de frein si elle peut être rendue récupérable (instantané pris juste avant).
  if (verdict.rule === 'delete' && verdict.deletion) {
    const check = autoApproveDeletion(store, verdict.deletion.targets, input.cwd);
    if (check.ok) {
      store.log({ type: 'guard.verdict', ...ids(input), data: { tool: input.tool_name, class: 'autonomous', rule: 'delete-with-snapshot', checkpoint: check.checkpointId } });
      const note = `[ceng] Suppression autorisée : instantané ${check.checkpointId} pris avant (annulable : \`${CLI_INVOCATION} rollback ${check.checkpointId} --apply\`).`;
      // « allow » seulement si la commande n'est QUE des suppressions ; sinon les permissions normales s'appliquent au reste.
      const onlyDeletions = splitCommand(command, shell).every((s) => parseDeletion(s) !== null);
      return { exitCode: 0, json: { hookSpecificOutput: { hookEventName: 'PreToolUse', ...(onlyDeletions ? { permissionDecision: 'allow', permissionDecisionReason: note } : {}), additionalContext: note } } };
    }
    store.log({ type: 'guard.verdict', ...ids(input), data: { tool: input.tool_name, class: 'approval', rule: 'delete', why: check.reason } });
    if (stageOf(store) === 'prototype' && !UNRECOVERABLE_DELETION.test(check.reason)) return allowInPrototype(store, input, ['delete', ...(verdict.freed ?? [])], `${command} (non annulable : ${check.reason})`);
    return askHuman(store, input, command, `Suppression non récupérable automatiquement (${check.reason}) : validation humaine.`, true);
  }
  store.log({ type: 'guard.verdict', ...ids(input), data: { tool: input.tool_name, class: verdict.class, rule: verdict.rule } });
  return verdict.class === 'forbidden'
    ? preToolDecision('deny', `Action interdite (${verdict.rule}) : ${verdict.reason} Proposer une alternative sûre ou demander à l'humain d'agir lui-même.`)
    : askHuman(store, input, command, `Approbation humaine requise (${verdict.rule}) : ${verdict.reason}`, isSingleUseCommand(command, shell));
}

export function guardFile(store: BrainStore, input: HookInput): HookOutput {
  const raw = String(input.tool_input?.['file_path'] ?? input.tool_input?.['notebook_path'] ?? '');
  if (!raw) return OK;
  const rel = relativeToProject(store, raw);
  if (rel.startsWith('..')) return OK; // hors projet : laissé aux permissions natives
  const config = store.config();
  const bypass = bypassOn(store);
  const classified = classifyFileWrite(rel, config.policy.autonomy, config.secrets?.allow ?? [], config.stage ?? 'production');
  // Bypass total : fichiers de secrets, garde-fous, CI, internes git compris. Seul reste le verrou entre agents (ci-dessous) : il évite un conflit, pas une action.
  const verdict = bypass && classified.class !== 'autonomous' ? { ...classified, class: 'autonomous' as const, freed: [classified.rule ?? 'file'] } : classified;
  if (verdict.class !== 'autonomous') {
    store.log({ type: 'guard.verdict', ...ids(input), data: { file: rel, class: verdict.class, rule: verdict.rule } });
    // Un fichier de gouvernance (garde-fous, licence…) : chaque modification est une décision, jamais une autorisation réutilisable.
    return verdict.class === 'forbidden' ? preToolDecision('deny', `${verdict.reason} (${rel})`) : askHuman(store, input, rel, `${verdict.reason} (${rel})`, verdict.rule === 'governance-file');
  }
  // Prévention de conflit : un worker ne modifie pas un fichier possédé par une autre tâche en cours.
  if (input.agent_id) {
    const state = store.state();
    const myTask = state.agentTasks?.[input.agent_id];
    if (myTask) {
      const tasks = store.tasks();
      const mine = tasks.find((t) => t.id === myTask);
      const inMyScope = mine && mine.files.length > 0 && matchesAny(rel, mine.files);
      // Seule une tâche réellement en cours de travail (un sous-agent actif la porte) bloque : une tâche restée
      // « in_progress » sans agent vivant (agent arrêté, session interrompue) ne doit jamais verrouiller ses fichiers.
      const inProgress = tasks.filter((t) => t.status === 'in_progress');
      const active = currentDelegation(store, inProgress).tasks;
      const owner = inProgress.find((t) => t.id !== myTask && active.has(t.id) && t.files.length > 0 && matchesAny(rel, t.files));
      if (owner && !inMyScope) {
        store.log({ type: 'conflict.detected', ...ids(input), taskId: myTask, data: { file: rel, owner: owner.id, prevented: true } });
        return preToolDecision('deny', `${rel} appartient à la tâche en cours ${owner.id}. Ne pas l'éditer : décrire le changement nécessaire dans ton rapport (ou message au propriétaire en Agent Team).`);
      }
    }
  }
  // Stade prototype : fichier de garde-fous, CI ou infra modifiable sans validation (la règle `ask` native est levée aussi).
  if (bypass) return verdict.freed?.length ? allowInBypass(store, input, rel, verdict.freed[0]) : allowDecision('Bypass total.');
  return verdict.freed?.length ? allowInPrototype(store, input, verdict.freed, rel) : OK;
}

/** PreToolUse sur Read (installé seulement quand des secrets sont autorisés) : les autres secrets restent illisibles. */
export function guardRead(store: BrainStore, input: HookInput): HookOutput {
  const raw = String(input.tool_input?.['file_path'] ?? '');
  if (!raw) return OK;
  const rel = relativeToProject(store, raw);
  if (rel.startsWith('..') || bypassOn(store)) return OK;
  const verdict = classifyFileRead(rel, store.config().secrets?.allow ?? []);
  if (verdict.class === 'autonomous') return OK;
  store.log({ type: 'guard.verdict', ...ids(input), data: { file: rel, class: verdict.class, rule: verdict.rule } });
  return preToolDecision('deny', `${verdict.reason} (${rel})`);
}

export function agentSpawn(store: BrainStore, input: HookInput): HookOutput {
  const ti = input.tool_input ?? {};
  const agentType = String(ti['subagent_type'] ?? 'general-purpose');
  const model = ti['model'] ? String(ti['model']) : undefined;
  const text = `${String(ti['description'] ?? '')}\n${String(ti['prompt'] ?? '')}`;
  const taskId = text.match(TASK_ID)?.[0];
  if (taskId) {
    store.updateState((s) => {
      const now = Date.now();
      s.pendingSpawns = [...(s.pendingSpawns ?? []).filter((p) => now - Date.parse(p.at) < SPAWN_MATCH_WINDOW_MS), { taskId, agentType, ...(model ? { model } : {}), at: new Date().toISOString() }];
    });
  }
  store.log({
    type: 'agent.spawn',
    ...(taskId ? { taskId } : {}),
    ...(model ? { model } : {}),
    agentType,
    data: { description: String(ti['description'] ?? '').slice(0, 120), background: Boolean(ti['run_in_background']), named: Boolean(ti['name']), isolation: ti['isolation'] ?? null, briefChars: String(ti['prompt'] ?? '').length },
  });
  return OK;
}

export function subagentStart(store: BrainStore, input: HookInput): HookOutput {
  if (!input.agent_id) return OK;
  const agentId = input.agent_id;
  let taskId: string | undefined;
  store.updateState((s) => {
    const pending = s.pendingSpawns ?? [];
    const i = pending.findIndex((p) => p.agentType === input.agent_type);
    if (i >= 0) {
      taskId = pending[i]!.taskId;
      pending.splice(i, 1);
      s.pendingSpawns = pending;
      s.agentTasks = { ...(s.agentTasks ?? {}), [agentId]: taskId };
    }
    // Toujours consigné, même sans tâche rattachée (valeur vide) : l'agent travaille, l'orchestrateur n'a pas à tourner en rond.
    s.runningAgents = { ...(s.runningAgents ?? {}), [agentId]: taskId ?? '' };
    s.agentStartedAt = { ...(s.agentStartedAt ?? {}), [agentId]: new Date().toISOString() };
  });
  store.log({ type: 'agent.spawn', ...ids(input), ...(taskId ? { taskId } : {}), data: { phase: 'started' } });
  if (!String(input.agent_type ?? '').startsWith('ceng-')) return OK;
  // État du projet que le sous-agent ne peut pas deviner (même sans CLAUDE.md : ceng-scout).
  const mode = bypassOn(store)
    ? 'BYPASS TOTAL actif : aucune validation à attendre ; secrets utilisés sans être affichés ni recopiés.'
    : stageOf(store) === 'prototype'
      ? 'Stade prototype : migrations, suppressions et push du projet sans validation.'
      : "Stade production : toute action à approbation humaine est remontée dans ton rapport, jamais tentée.";
  const note = `[ceng] ${taskId ? `Tâche rattachée : ${taskId}. ` : ''}${mode} Termine par le bloc ${REPORT_MARKER}.`;
  return { exitCode: 0, json: { hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: note } } };
}

export function fileEdited(store: BrainStore, input: HookInput): HookOutput {
  const raw = String(input.tool_input?.['file_path'] ?? input.tool_input?.['notebook_path'] ?? '');
  if (!raw) return OK;
  const rel = relativeToProject(store, raw);
  if (rel.startsWith('.ceng/') || rel.startsWith('graphify-out/')) return OK;
  // Seules les modifications de la session principale comptent pour le checkpoint de fin de tour : celles des
  // sous-agents (souvent en arrière-plan) ne sont pas le travail de ce tour. Le graphe de code, lui, voit tout.
  const state = store.updateState((s) => {
    if (!input.agent_id) s.editsSinceCheckpoint += 1;
    s.graphDirty = true;
  });
  const taskId = (input.agent_id && state.agentTasks?.[input.agent_id]) || state.currentTask;
  store.log({ type: 'file.edited', ...ids(input), ...(taskId ? { taskId } : {}), data: { file: rel, tool: input.tool_name } });
  return OK;
}

/** Dépendance ajoutée à un manifeste sans vérification : l'agent doit la choisir en connaissance de cause, tout de suite. */
function dependencyNote(store: BrainStore): string | undefined {
  try {
    if (!readVetted(store)) return undefined;
    const missing = unvettedDeps(store);
    return missing.length ? `[ceng] Dépendance(s) non vérifiée(s) : ${missing.map((d) => d.name).join(', ')} — lancer \`${CLI_INVOCATION} dep check\` (licence, maintenance, vulnérabilités, usage) AVANT de continuer ; une alternative déjà présente ou la bibliothèque standard fait-elle l'affaire ?` : undefined;
  } catch {
    return undefined;
  }
}

/** PostToolUse d'écriture : suivi du fichier modifié puis contrôle du code, en un seul processus. */
export function afterEdit(store: BrainStore, input: HookInput): HookOutput {
  fileEdited(store, input);
  return codeCheck(store, input);
}

/** Texte écrit par l'outil : contenu entier (Write) ou fragments remplaçants (Edit, MultiEdit). */
function writtenText(ti: Record<string, unknown>): string {
  if (typeof ti['content'] === 'string') return ti['content'];
  if (typeof ti['new_string'] === 'string') return ti['new_string'];
  const edits = ti['edits'];
  return Array.isArray(edits) ? edits.map((e) => String((e as Record<string, unknown>)?.['new_string'] ?? '')).join('\n') : '';
}

/**
 * PostToolUse Edit/Write : contrôle immédiat du code écrit. Silencieux quand tout va bien (aucun jeton) ; sinon un
 * avertissement court renvoyé à l'agent, ou un retour bloquant pour un défaut de sécurité (secret en dur, injection, eval).
 */
export function codeCheck(store: BrainStore, input: HookInput): HookOutput {
  const ti = input.tool_input ?? {};
  const raw = String(ti['file_path'] ?? '');
  if (!raw) return OK;
  const cfg = store.config().codeCheck;
  if (cfg?.enabled === false) return OK;
  const rel = relativeToProject(store, raw);
  if (rel.startsWith('..')) return OK;
  const depNote = isManifest(rel) ? dependencyNote(store) : undefined;
  const text = writtenText(ti);
  if (!text) return OK;
  let total = 0;
  try {
    const abs = path.isAbsolute(raw) ? raw : path.join(store.paths.root, raw);
    total = (readText(abs) ?? text).split(/\r?\n/).length;
  } catch {
    total = text.split(/\r?\n/).length;
  }
  const findings = checkCode(rel, text, total, { ...DEFAULT_LIMITS, ...Object.fromEntries(Object.entries(cfg ?? {}).filter(([k, v]) => k !== 'enabled' && typeof v === 'number')) }, listRules(store));
  if (!findings.length && !depNote) return OK;
  if (!findings.length) return { exitCode: 0, json: { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: depNote! } } };
  store.log({ type: 'code.check', ...ids(input), data: { file: rel, rules: findings.map((f) => f.rule) } });
  const message = [formatFindings(rel, findings), depNote].filter(Boolean).join('\n');
  return findings.some((f) => f.severity === 'block')
    ? { exitCode: 0, json: { decision: 'block', reason: message, hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message } } }
    : { exitCode: 0, json: { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message } } };
}

/** PostToolUse SubagentHandback : le rapport passe par l'outil de remise, pas par le dernier message du sous-agent. */
export function agentHandback(store: BrainStore, input: HookInput): HookOutput {
  const id = input.agent_id;
  if (!id || !String(input.tool_input?.['message'] ?? '').includes(REPORT_MARKER)) return OK;
  store.updateState((s) => {
    s.handbackReports = { ...(s.handbackReports ?? {}), [id]: true };
  });
  return OK;
}

export function skillUsed(store: BrainStore, input: HookInput): HookOutput {
  const skill = String(input.tool_input?.['skill'] ?? input.tool_input?.['name'] ?? '');
  if (skill) store.log({ type: 'skill.used', ...ids(input), data: { skill } });
  if (skill === 'ceng-orchestrate' && !input.agent_id) markAutopilot(store, input.session_id);
  return OK;
}

export function subagentStop(store: BrainStore, input: HookInput): HookOutput {
  const agentType = input.agent_type ?? '';
  const taskId = input.agent_id ? store.state().agentTasks?.[input.agent_id] : undefined;
  const message = String(input.last_assistant_message ?? '');
  const handedBack = Boolean(input.agent_id && store.state().handbackReports?.[input.agent_id]);
  const hasReport = message.includes(REPORT_MARKER) || handedBack;
  store.log({ type: 'agent.stop', ...ids(input), ...(taskId ? { taskId } : {}), data: { hasReport } });
  if (input.agent_id && input.agent_id in (store.state().runningAgents ?? {})) {
    store.updateState((s) => {
      const running = { ...(s.runningAgents ?? {}) };
      const started = { ...(s.agentStartedAt ?? {}) };
      delete running[input.agent_id!];
      delete started[input.agent_id!];
      s.runningAgents = running;
      s.agentStartedAt = started;
    });
  }
  if (input.agent_id && store.state().handbackReports?.[input.agent_id]) {
    store.updateState((s) => {
      if (s.handbackReports) delete s.handbackReports[input.agent_id!];
    });
  }
  if (!agentType.startsWith('ceng-') || hasReport || input.stop_hook_active) return OK;
  store.log({ type: 'agent.report-missing', ...ids(input), ...(taskId ? { taskId } : {}) });
  return {
    exitCode: 0,
    json: {
      decision: 'block',
      reason:
        `[ceng] Avant de terminer : ${taskId ? `écris le rapport .ceng/brain/reports/${taskId}.md (si ton rôle permet l'écriture), puis ` : ''}` +
        `termine ta réponse par le bloc ${REPORT_MARKER} défini dans tes instructions (statut, fait, fichiers, tests, décisions, risques, suite). ` +
        'L\'orchestrateur ne lit que ce résumé : sans lui, ton travail est perdu pour les sessions suivantes.',
    },
  };
}

export function preCompact(store: BrainStore, input: HookInput): HookOutput {
  const state = store.state();
  createCheckpoint(store, {
    done: `Checkpoint automatique avant compaction (${input.trigger ?? 'auto'})`,
    next: state.lastCheckpoint?.next ?? 'Relire .ceng/brain/INDEX.md et la tâche en cours',
    auto: true,
  });
  store.updateState((s) => {
    s.compactions = (s.compactions ?? 0) + 1;
  });
  store.log({ type: 'compaction', ...ids(input), data: { trigger: input.trigger ?? 'auto' } });
  // La sortie standard d'un hook PreCompact sert d'instructions au résumé de compaction.
  return {
    exitCode: 0,
    stdout: [
      'Dans le résumé, conserver : identifiant et titre des tâches ceng en cours, sous-agents lancés et tâche de chacun,',
      "décisions prises pendant la session et leur raison, questions posées à l'humain et ses réponses, prochaine action exacte.",
      "Ne pas conserver : contenu des fichiers lus, sorties d'outils, détail des explorations.",
    ].join(' '),
  };
}

/** Rappel de checkpoint volontaire : au plus un toutes les 2 h, et seulement si aucun n'a été pris depuis 2 h. */
const REMINDER_INTERVAL_MS = 2 * 3_600_000;
const DEFAULT_NEXT = 'Relire .ceng/brain/INDEX.md et la tâche en cours';

/**
 * Fin de tour de la session principale. Le travail du tour est protégé sans rien demander à personne : un checkpoint
 * AUTOMATIQUE silencieux (récit + instantané git) est pris s'il y a eu des modifications. Le hook ne bloque jamais pour
 * un checkpoint ; il peut seulement, au plus toutes les 2 h, rappeler (message non bloquant) qu'aucun checkpoint
 * VOLONTAIRE — celui qui dit vraiment « fait / prochaine étape » — n'a été pris depuis 2 h.
 */
export function stop(store: BrainStore, input: HookInput): HookOutput {
  if (input.agent_id) return OK;
  const edits = autoCheckpoint(store);
  if (isUnattended()) return keepWorkingOrStop(store);
  // Session d'orchestration : le travail continue sans attendre l'humain (il peut interrompre ou écrire à tout moment).
  // Pilote automatique : seulement quand l'humain n'a rien écrit récemment. S'il est là (message de moins de
  // PRESENCE_WINDOW_MS), on lui rend la main au lieu de relancer la boucle.
  const autopilot = store.state();
  const humanRecent = Boolean(autopilot.lastHumanAt && Date.now() - Date.parse(autopilot.lastHumanAt) < PRESENCE_WINDOW_MS);
  if (input.session_id && autopilot.autopilotSessionId === input.session_id && (!humanRecent || isHumanAway(store))) return keepWorkingOrStop(store);
  return edits > 0 ? voluntaryCheckpointReminder(store) : OK;
}

/** Checkpoint automatique de fin de tour ; renvoie le nombre de modifications couvertes (0 : rien à protéger ou échec). */
function autoCheckpoint(store: BrainStore): number {
  const edits = store.state().editsSinceCheckpoint;
  if (edits <= 0) return 0;
  try {
    createCheckpoint(store, {
      done: `Checkpoint automatique en fin de tour (${edits} fichier${edits > 1 ? 's' : ''})`,
      next: lastVoluntaryCheckpoint(store)?.next ?? DEFAULT_NEXT,
      auto: true,
    });
    return edits;
  } catch (err) {
    // La fin de tour ne doit jamais échouer à cause de la sauvegarde : l'échec est consigné, le compteur reste pour le tour suivant.
    store.log({ type: 'checkpoint', data: { auto: true, failed: String((err as Error).message).slice(0, 200) } });
    return 0;
  }
}

function lastVoluntaryCheckpoint(store: BrainStore): CheckpointRecord | undefined {
  return store.checkpoints().reverse().find((c) => !c.auto);
}

function voluntaryCheckpointReminder(store: BrainStore): HookOutput {
  const now = Date.now();
  const last = lastVoluntaryCheckpoint(store);
  if (last && now - Date.parse(last.at) < REMINDER_INTERVAL_MS) return OK;
  const reminded = store.state().checkpointReminderAt;
  if (reminded && now - Date.parse(reminded) < REMINDER_INTERVAL_MS) return OK;
  store.updateState((s) => {
    s.checkpointReminderAt = new Date(now).toISOString();
  });
  return {
    exitCode: 0,
    json: {
      systemMessage:
        '[ceng] Aucun checkpoint volontaire depuis plus de 2 h (le travail est sauvegardé par des checkpoints automatiques). ' +
        `À la fin d'une étape : \`${CLI_INVOCATION} checkpoint --done "…" --next "…"\` — la reprise saura ainsi quoi faire ensuite.`,
    },
  };
}

/** Mode sans humain : relancer l'orchestrateur tant qu'il reste du travail faisable et qu'il progresse. */
function keepWorkingOrStop(store: BrainStore): HookOutput {
  const decision = shouldKeepWorking(store);
  store.log({ type: 'unattended.continue', data: { continue: decision.continue, reason: decision.reason } });
  if (!decision.continue) return OK;
  return {
    exitCode: 0,
    json: {
      decision: 'block',
      reason:
        `[ceng] MODE SANS HUMAIN : ${decision.reason}. Ne t'arrête pas : checkpoint si besoin, puis \`${CLI_INVOCATION} plan\` et continue la boucle ` +
        "(protocole ceng-orchestrate). Ce qui exige l'humain : `task block` + passer à une tâche indépendante. Termine seulement quand plus rien n'est faisable.",
    },
  };
}

export function stopFailure(store: BrainStore, input: HookInput): HookOutput {
  const type = String(input['error_type'] ?? input['error'] ?? input['reason'] ?? 'unknown');
  store.updateState((s) => {
    s.interruption = { type, at: new Date().toISOString(), ...(input['error_message'] ? { detail: String(input['error_message']).slice(0, 300) } : {}) };
  });
  store.log({ type: 'session.interrupted', ...ids(input), data: { type } });
  return OK;
}

export function taskCompleted(store: BrainStore, input: HookInput): HookOutput {
  const text = `${String(input['task_subject'] ?? '')} ${String(input['task_description'] ?? '')}`;
  const id = text.match(TASK_ID)?.[0];
  if (!id) return OK;
  const task = store.tasks().find((t) => t.id === id);
  if (!task || task.status === 'done') return OK;
  const check = completionCheck(store, task);
  if (check.ok) return OK;
  return { exitCode: 2, stderr: `[ceng] ${id} : gates requises non satisfaites (${check.missing.join(', ')}). Lancer \`${CLI_INVOCATION} gate run ${id}\` puis \`task done\`.` };
}

/** Graphe de code : construction/mise à jour en arrière-plan (sans LLM). Hook asynchrone, jamais bloquant. */
export function graphRefresh(store: BrainStore, input: HookInput): HookOutput {
  const trigger = input.hook_event_name === 'SessionStart' ? 'session-start' : 'turn-end';
  const decision = refreshIfNeeded(store, trigger);
  if (decision.action !== 'none') store.log({ type: 'graph.refresh', ...ids(input), data: { action: decision.action, reason: decision.reason } });
  return OK;
}

/** UserPromptSubmit : l'humain est là (base de la détection d'absence) ; /ceng-orchestrate active le pilote automatique. */
export function userPrompt(store: BrainStore, input: HookInput): HookOutput {
  if (markHumanActive(store, String(input['prompt'] ?? ''), input.session_id)) clearRefusals(store);
  const notes = [recallNote(store, String(input['prompt'] ?? ''), input.session_id), contextRotNote(store, String(input['transcript_path'] ?? ''))].filter(Boolean);
  return notes.length ? { exitCode: 0, json: { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: notes.join('\n') } } } : OK;
}

/** Mots de la demande qui comptent : en dessous de 4, c'est une réponse courte (« oui », « continue »), pas une demande. */
const meaningful = (prompt: string): number => new Set(tokenize(prompt)).size;

/**
 * À chaque demande de l'humain : ce que la mémoire du projet contient déjà de proche (fonctionnalités livrées ou écartées,
 * tâches, décisions, réponses données). Silencieux quand rien ne ressemble. Une fois par élément et par session.
 */
function recallNote(store: BrainStore, prompt: string, sessionId?: string): string | undefined {
  if (prompt.startsWith('/') || meaningful(prompt) < 4) return undefined;
  const seen = store.state().recalled ?? { session: '', ids: [] };
  const known = seen.session === (sessionId ?? '') ? new Set(seen.ids) : new Set<string>();
  const hits = recall(store, prompt).filter((h) => !known.has(h.id) || h.dead);
  if (!hits.length) return undefined;
  store.updateState((s) => {
    s.recalled = { session: sessionId ?? '', ids: [...new Set([...known, ...hits.map((h) => h.id)])].slice(-60) };
  });
  return renderRecall(hits);
}

/**
 * Contexte long = précision en baisse (« context rot »). Au message de l'humain, si la transcription est lourde ou déjà
 * compactée plusieurs fois, l'orchestrateur est prévenu UNE fois par palier : checkpoint précis puis nouvelle session
 * (le Brain porte la suite). Mesure approchée (taille du fichier de transcription), réglable : `contextGuard.warnKb`.
 */
function contextRotNote(store: BrainStore, transcript: string): string | undefined {
  const cfg = store.config().contextGuard;
  if (cfg?.enabled === false) return undefined;
  const warnKb = cfg?.warnKb ?? 1200;
  let kb = 0;
  try {
    kb = transcript ? Math.round(fs.statSync(transcript).size / 1024) : 0;
  } catch {
    kb = 0;
  }
  const state = store.state();
  const compactions = state.compactions ?? 0;
  const level = kb >= warnKb * 2 ? 2 : kb >= warnKb || compactions >= 2 ? 1 : 0;
  if (level === 0 || level <= (state.contextWarnLevel ?? 0)) return undefined;
  store.updateState((s) => {
    s.contextWarnLevel = level;
  });
  store.log({ type: 'session.start', data: { contextRot: true, kb, compactions } });
  return `[ceng] Contexte chargé (transcription ~${kb} ko, ${compactions} compaction(s)) : un contexte long dégrade la précision. À la fin de l'étape en cours : \`${CLI_INVOCATION} checkpoint --done "…" --next "…"\` précis, puis une nouvelle session reprend depuis le Brain (\`${CLI_INVOCATION} run --resume\`). Les recherches volumineuses partent chez \`ceng-scout\`.`;
}

/**
 * PermissionRequest (avant l'affichage d'une boîte de permission, y compris celles de Claude Code lui-même).
 * Ces boîtes n'expirent jamais : on les remplace par l'invite de questions (qui expire), sauf si la bascule est désactivée.
 * L'invite elle-même n'est jamais interceptée : la refuser renverrait vers… l'invite (boucle infinie).
 */
/**
 * PreToolUse sur les outils MCP (mode équipe autonome seulement) : lecture, coordination et outils locaux passent sans boîte de permission ;
 * tout ce qui agit hors de la machine (base, déploiement, e-mail, paiement, secrets) est refusé proprement et consigné pour l'humain.
 */
export function guardMcp(store: BrainStore, input: HookInput): HookOutput {
  if (bypassOn(store)) {
    store.log({ type: 'guard.verdict', ...ids(input), data: { tool: input.tool_name, class: 'autonomous', rule: 'bypass' } });
    return allowDecision('Bypass total.');
  }
  if (!teamOn(store)) return OK;
  const name = String(input.tool_name ?? '');
  const team = store.config().team;
  const verdict = classifyTeamTool(name, { ...(team?.mcpAllow ? { mcpAllow: team.mcpAllow } : {}), ...(team?.mcpDefer ? { mcpDefer: team.mcpDefer } : {}) });
  store.log({ type: 'guard.verdict', ...ids(input), data: { tool: name, class: verdict.decision === 'allow' ? 'autonomous' : 'deferred-to-human', rule: 'team-mode', reason: verdict.reason } });
  if (verdict.decision === 'allow') {
    return { exitCode: 0, json: { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: `[ceng] Équipe autonome : ${verdict.reason}.` } } };
  }
  recordPendingApproval(store, name, verdict.reason);
  return preToolDecision('deny', deferredReason(verdict.reason));
}

export function permissionRequest(store: BrainStore, input: HookInput): HookOutput {
  if (input.tool_name === 'AskUserQuestion') return OK;
  if (bypassOn(store)) {
    store.log({ type: 'guard.verdict', ...ids(input), data: { tool: input.tool_name, class: 'autonomous', rule: 'bypass' } });
    return { exitCode: 0, json: { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } } };
  }
  if (teamOn(store)) return teamPermission(store, input);
  if (!presenceEnabled(store) && !isUnattended()) return OK;
  const ti = input.tool_input ?? {};
  const key = actionKey(String(input.tool_name ?? ''), ti);
  const decide = (behavior: 'allow' | 'deny', message?: string): HookOutput => ({
    exitCode: 0,
    json: { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior, ...(message ? { message } : {}) } } },
  });
  if (consumeGrant(store, key, false) || consumeHandoff(store, key)) return decide('allow');
  const refusal = findRefusal(store, key);
  if (refusal) return decide('deny', refusedMessage(refusal));
  const what = `${input.tool_name ?? 'outil'} ${String(ti['command'] ?? ti['file_path'] ?? ti['url'] ?? '').slice(0, 160)}`.trim();
  if (isHumanAway(store)) {
    const reason = "Permission requise alors que l'humain est absent";
    recordPendingApproval(store, what, reason);
    return decide('deny', deferredReason(reason));
  }
  return decide('deny', askViaInvite(openRequest(store, key, what, 'permission Claude Code', isSingleUsePermission(store, input))));
}

/** Une écriture est permise à l'équipe dans le projet courant, son dépôt principal (copies de travail) et le dossier temporaire. */
function writableByTeam(store: BrainStore, file: string): boolean {
  const abs = path.resolve(path.isAbsolute(file) ? file : path.join(store.paths.root, file));
  const roots = [store.paths.root, mainRoot(store.paths.root), os.tmpdir()];
  return roots.some((r) => {
    const rel = path.relative(path.resolve(r), abs);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

/** Boîte de permission native en mode équipe autonome : commande classée par les garde-fous, autre outil par la liste de sécurité. */
function teamPermission(store: BrainStore, input: HookInput): HookOutput {
  const decide = (behavior: 'allow' | 'deny', message?: string): HookOutput => ({
    exitCode: 0,
    json: { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior, ...(message ? { message } : {}) } } },
  });
  const ti = input.tool_input ?? {};
  const toolName = String(input.tool_name ?? '');
  const command = typeof ti['command'] === 'string' ? ti['command'] : '';
  if (command && /^(Bash|PowerShell)$/.test(toolName)) {
    const verdict = classifyCommand(command, commandContext(store, input, command, shellOf(toolName)));
    if (verdict.class === 'autonomous') return decide('allow');
    if (verdict.class === 'forbidden') return decide('deny', `[ceng] Action interdite (${verdict.rule}) : ${verdict.reason}`);
    recordPendingApproval(store, `${toolName} ${command.slice(0, 160)}`, verdict.reason);
    return decide('deny', deferredReason(verdict.reason));
  }
  // Écriture hors du projet (et de son dépôt principal, dossier temporaire compris) : jamais décidée à la place de l'humain.
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(toolName)) {
    const file = String(ti['file_path'] ?? ti['notebook_path'] ?? '');
    if (file && !writableByTeam(store, file)) {
      const reason = `Écriture hors du projet (${file.slice(0, 120)}) : validation humaine`;
      recordPendingApproval(store, `${toolName} ${file.slice(0, 160)}`, reason);
      return decide('deny', deferredReason(reason));
    }
  }
  const team = store.config().team;
  const verdict = classifyTeamTool(toolName, { ...(team?.mcpAllow ? { mcpAllow: team.mcpAllow } : {}), ...(team?.mcpDefer ? { mcpDefer: team.mcpDefer } : {}) });
  if (verdict.decision === 'allow') return decide('allow');
  const what = `${toolName} ${String(ti['file_path'] ?? ti['url'] ?? '').slice(0, 160)}`.trim();
  recordPendingApproval(store, what, verdict.reason);
  return decide('deny', deferredReason(verdict.reason));
}

/** Une autorisation de boîte native est à usage unique pour une opération destructive ou un fichier de gouvernance. */
function isSingleUsePermission(store: BrainStore, input: HookInput): boolean {
  const ti = input.tool_input ?? {};
  if (typeof ti['command'] === 'string') return isSingleUseCommand(ti['command'], shellOf(String(input.tool_name ?? '')));
  const file = String(ti['file_path'] ?? ti['notebook_path'] ?? '');
  if (!file) return false;
  const rel = relativeToProject(store, file);
  return !rel.startsWith('..') && classifyFileWrite(rel, store.config().policy.autonomy, store.config().secrets?.allow ?? []).rule === 'governance-file';
}

/**
 * PreToolUse sur AskUserQuestion, humain absent : la question n'attend pas. Traitement selon l'impact déclaré
 * dans la question (« [impact: fort] » / « [impact: faible] ») :
 *  - impact faible (ou non précisé) : la recommandation devient une décision provisoire, le travail continue ;
 *  - impact fort : on ne construit pas sur une supposition — seules les tâches qui dépendent du choix attendent,
 *    tout le reste avance.
 */
export function askQuestion(store: BrainStore, input: HookInput): HookOutput {
  if (!isHumanAway(store)) return OK;
  const questions = (input.tool_input?.['questions'] as { question?: string; header?: string; options?: { label?: string }[] }[] | undefined) ?? [];
  const highImpact = questions.some((q) => /impact\s*:\s*fort|impact\s*:\s*high/i.test(`${q.header ?? ''} ${q.question ?? ''}`));
  const chosen: string[] = [];
  for (const q of questions) {
    const labels = (q.options ?? []).map((o) => o.label ?? '').filter(Boolean);
    const recommended = labels.find((l) => /recommand/i.test(l)) ?? labels[0] ?? 'option la plus réversible';
    chosen.push(recommended);
    const outcome = highImpact ? 'impact fort : tâches dépendantes en attente' : `provisoire : ${recommended}`;
    recordPendingApproval(store, `QUESTION : ${q.question ?? '?'}${labels.length ? ` [${labels.join(' | ')}]` : ''} → ${outcome}`, 'Question posée pendant une absence');
  }
  if (highImpact) {
    return preToolDecision(
      'deny',
      '[ceng] Humain absent et décision COÛTEUSE à changer : question mise en file, à lui reposer à son retour. Ne construis PAS sur une supposition : ' +
        `\`${CLI_INVOCATION} decision add --status pending --impact high …\`, bloque seulement les tâches qui dépendent de ce choix ` +
        `(\`${CLI_INVOCATION} task block <id> --reason "attend décision ADR-…"\`) et continue toutes les tâches indépendantes.`,
    );
  }
  return preToolDecision(
    'deny',
    `[ceng] Humain absent : question mise en file, à lui reposer à son retour. Applique ta recommandation comme DÉCISION PROVISOIRE (${chosen.join(' ; ')}) : ` +
      `\`${CLI_INVOCATION} checkpoint --done "avant décision provisoire" --next "…"\`, puis \`${CLI_INVOCATION} decision add --status provisional --impact low --autonomous …\` ` +
      '(préciser ce qui en dépend), garde le choix isolé si cela ne coûte presque rien (interface, configuration), et continue.',
  );
}

/**
 * PostToolUse sur AskUserQuestion : lit la réponse RÉELLE de l'humain (l'option choisie porte « R-xxxx » :
 * « Approuver » -> autorisation à usage unique, « Refuser » -> refus) et dit à Claude quoi faire ensuite.
 * Une vraie réponse prouve la présence de l'humain ; une invite fermée par expiration signale son absence.
 * Hook synchrone : l'autorisation doit exister avant que Claude relance l'action.
 */
export function questionAnswered(store: BrainStore, input: HookInput): HookOutput {
  const response = input['tool_response'];
  if (isTimeout(response)) {
    markHumanAway(store);
    return OK;
  }
  const outcome = applyAnswers(store, response);
  if (outcome.verdicts.length) {
    store.log({
      type: 'guard.verdict',
      ...ids(input),
      data: { class: 'human-answer', approved: outcome.approved.map((r) => r.id), refused: outcome.refused.map((r) => r.id), unknown: outcome.unknown, unclear: outcome.unclear, answers: outcome.verdicts.map((v) => v.answer) },
    });
  }
  markHumanAnswered(store);
  try {
    logAnswers(store, response, store.state().currentTask);
  } catch {
    /* la mémoire des réponses ne doit jamais bloquer */
  }
  const feedback = answerFeedback(outcome);
  return feedback ? { exitCode: 0, json: { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: feedback } } } : OK;
}

export function sessionEnd(store: BrainStore, input: HookInput): HookOutput {
  store.log({ type: 'session.end', ...ids(input), data: { reason: input['reason'] ?? null } });
  return OK;
}

function ids(input: HookInput) {
  return {
    ...(input.session_id ? { sessionId: input.session_id } : {}),
    ...(input.agent_id ? { agentId: input.agent_id } : {}),
    ...(input.agent_type ? { agentType: input.agent_type } : {}),
  };
}

export const HANDLERS: Record<string, (store: BrainStore, input: HookInput) => HookOutput> = {
  'session-start': sessionStart,
  'guard-command': guardCommand,
  'command-done': commandDone,
  'code-check': codeCheck,
  'guard-file': guardFile,
  'agent-spawn': agentSpawn,
  'subagent-start': subagentStart,
  'file-edited': fileEdited,
  'after-edit': afterEdit,
  'skill-used': skillUsed,
  'agent-handback': agentHandback,
  'subagent-stop': subagentStop,
  'pre-compact': preCompact,
  stop,
  'stop-failure': stopFailure,
  'task-completed': taskCompleted,
  'session-end': sessionEnd,
  'graph-refresh': graphRefresh,
  'guard-read': guardRead,
  'user-prompt': userPrompt,
  'permission-request': permissionRequest,
  'guard-mcp': guardMcp,
  'question-answered': questionAnswered,
  'ask-question': askQuestion,
};
