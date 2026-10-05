import * as path from 'node:path';
import { classifyCommand, classifyFileRead, classifyFileWrite, parseDeletion, splitCommand } from '../domain/guardrails.js';
import { autoApproveDeletion } from '../app/deletion.js';
import { deferredReason, isUnattended, recordPendingApproval, shouldKeepWorking } from '../app/unattended.js';
import { isHumanAway, markAutopilot, markHumanActive, markHumanAnswered, markHumanAway, presenceEnabled } from '../app/presence.js';
import { actionKey, answerFeedback, applyAnswers, askViaInvite, clearRefusals, consumeGrant, consumeHandoff, findRefusal, openRequest, refusedMessage } from '../app/approvals.js';
import { isTimeout } from '../domain/answers.js';
import { removeOrphanTemps } from '../infra/fs.js';
import { matchesAny, normalizePath } from '../domain/globs.js';
import { resumeBrief } from '../brain/brief.js';
import type { BrainStore } from '../brain/store.js';
import { createCheckpoint } from '../app/checkpoints.js';
import { completionCheck } from '../app/tasks.js';
import { CLI_INVOCATION } from '../brain/paths.js';
import { currentDelegation } from '../app/delegation.js';
import { graphDisabledByEnv, graphifyAvailable, refreshIfNeeded } from '../app/codegraph.js';

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
  stderr?: string;
  exitCode: number;
}

const OK: HookOutput = { exitCode: 0 };
const TASK_ID = /\bT-\d{4}\b/;
const REPORT_MARKER = 'CENG_REPORT';
const SPAWN_MATCH_WINDOW_MS = 10 * 60_000;

/**
 * Demande d'approbation humaine, toujours par l'invite de questions (qui peut expirer) :
 *  - autorisation déjà donnée par l'humain pour cette action exacte -> autorisée (usage unique) ;
 *  - action refusée par l'humain -> bloquée sans reposer la question (jusqu'à son prochain message) ;
 *  - humain absent (invite expirée, mode nuit) -> refus propre, consigné pour son retour ; Claude continue ;
 *  - sinon -> refus avec la consigne de poser la question via AskUserQuestion (identifiant unique R-xxxx).
 * Bascule désactivable (`presence.enabled: false`) : on retombe alors sur la boîte de permission native.
 */
function askHuman(store: BrainStore, input: HookInput, what: string, reason: string): HookOutput {
  const key = actionKey(String(input.tool_name ?? ''), input.tool_input);
  const grant = consumeGrant(store, key);
  if (grant) {
    store.log({ type: 'guard.verdict', ...ids(input), data: { class: 'approved-by-human', request: grant.requestId } });
    return { exitCode: 0, json: { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: `[ceng] Approuvé par l'humain (${grant.requestId}), autorisation consommée.` } } };
  }
  const refusal = findRefusal(store, key);
  if (refusal) return preToolDecision('deny', refusedMessage(refusal));
  if (isHumanAway(store)) {
    recordPendingApproval(store, what, reason);
    return preToolDecision('deny', deferredReason(reason));
  }
  if (!presenceEnabled(store)) return preToolDecision('ask', reason);
  return preToolDecision('deny', askViaInvite(openRequest(store, key, what, reason)));
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
    }
  });
  removeOrphanTemps(store.paths.brain);
  store.log({ type: 'session.start', ...(input.session_id ? { sessionId: input.session_id } : {}), data: { source } });
  const brief = [resumeBrief(store, source), ...machineWarnings(store)].join('\n');
  return { exitCode: 0, json: { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: brief } } };
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

export function guardCommand(store: BrainStore, input: HookInput): HookOutput {
  const command = String(input.tool_input?.['command'] ?? '');
  if (!command) return OK;
  const config = store.config();
  const protectedBranches = store.profile()?.git.protectedBranches ?? ['main', 'master'];
  const shell = input.tool_name === 'PowerShell' ? 'powershell' : 'bash';
  const verdict = classifyCommand(command, { autonomy: config.policy.autonomy, protectedBranches, allowedSecrets: config.secrets?.allow ?? [], shell });
  if (verdict.class === 'autonomous') return OK;
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
    return askHuman(store, input, command, `Suppression non récupérable automatiquement (${check.reason}) : validation humaine.`);
  }
  store.log({ type: 'guard.verdict', ...ids(input), data: { tool: input.tool_name, class: verdict.class, rule: verdict.rule } });
  return verdict.class === 'forbidden'
    ? preToolDecision('deny', `Action interdite (${verdict.rule}) : ${verdict.reason} Proposer une alternative sûre ou demander à l'humain d'agir lui-même.`)
    : askHuman(store, input, command, `Approbation humaine requise (${verdict.rule}) : ${verdict.reason}`);
}

export function guardFile(store: BrainStore, input: HookInput): HookOutput {
  const raw = String(input.tool_input?.['file_path'] ?? input.tool_input?.['notebook_path'] ?? '');
  if (!raw) return OK;
  const rel = relativeToProject(store, raw);
  if (rel.startsWith('..')) return OK; // hors projet : laissé aux permissions natives
  const config = store.config();
  const verdict = classifyFileWrite(rel, config.policy.autonomy, config.secrets?.allow ?? []);
  if (verdict.class !== 'autonomous') {
    store.log({ type: 'guard.verdict', ...ids(input), data: { file: rel, class: verdict.class, rule: verdict.rule } });
    return verdict.class === 'forbidden' ? preToolDecision('deny', `${verdict.reason} (${rel})`) : askHuman(store, input, rel, `${verdict.reason} (${rel})`);
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
  return OK;
}

/** PreToolUse sur Read (installé seulement quand des secrets sont autorisés) : les autres secrets restent illisibles. */
export function guardRead(store: BrainStore, input: HookInput): HookOutput {
  const raw = String(input.tool_input?.['file_path'] ?? '');
  if (!raw) return OK;
  const rel = relativeToProject(store, raw);
  if (rel.startsWith('..')) return OK;
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
  return OK;
}

export function fileEdited(store: BrainStore, input: HookInput): HookOutput {
  const raw = String(input.tool_input?.['file_path'] ?? input.tool_input?.['notebook_path'] ?? '');
  if (!raw) return OK;
  const rel = relativeToProject(store, raw);
  if (rel.startsWith('.ceng/') || rel.startsWith('graphify-out/')) return OK;
  const state = store.updateState((s) => {
    s.editsSinceCheckpoint += 1;
    s.graphDirty = true;
  });
  const taskId = (input.agent_id && state.agentTasks?.[input.agent_id]) || state.currentTask;
  store.log({ type: 'file.edited', ...ids(input), ...(taskId ? { taskId } : {}), data: { file: rel, tool: input.tool_name } });
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
  const hasReport = message.includes(REPORT_MARKER);
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
  store.log({ type: 'compaction', ...ids(input), data: { trigger: input.trigger ?? 'auto' } });
  return OK;
}

export function stop(store: BrainStore, input: HookInput): HookOutput {
  if (input.agent_id) return OK;
  if (isUnattended()) return keepWorkingOrStop(store);
  // Session d'orchestration : le travail continue sans attendre l'humain (il peut interrompre ou écrire à tout moment).
  if (input.session_id && store.state().autopilotSessionId === input.session_id) return keepWorkingOrStop(store);
  if (input.stop_hook_active) return OK;
  const state = store.state();
  if (!state.currentTask || state.editsSinceCheckpoint === 0 || state.stopReminderAt) return OK;
  store.updateState((s) => {
    s.stopReminderAt = new Date().toISOString();
  });
  return {
    exitCode: 0,
    json: {
      decision: 'block',
      reason:
        `[ceng] ${state.editsSinceCheckpoint} modification(s) sur ${state.currentTask} depuis le dernier checkpoint. ` +
        `Avant de rendre la main : \`${CLI_INVOCATION} checkpoint --task ${state.currentTask} --done "…" --next "…"\` ` +
        '(une session future doit pouvoir reprendre sans cette conversation). Si la tâche est finie : gates puis `task done`.',
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
  return OK;
}

/**
 * PermissionRequest (avant l'affichage d'une boîte de permission, y compris celles de Claude Code lui-même).
 * Ces boîtes n'expirent jamais : on les remplace par l'invite de questions (qui expire), sauf si la bascule est désactivée.
 * L'invite elle-même n'est jamais interceptée : la refuser renverrait vers… l'invite (boucle infinie).
 */
export function permissionRequest(store: BrainStore, input: HookInput): HookOutput {
  if (input.tool_name === 'AskUserQuestion') return OK;
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
  return decide('deny', askViaInvite(openRequest(store, key, what, 'permission Claude Code')));
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
  'guard-file': guardFile,
  'agent-spawn': agentSpawn,
  'subagent-start': subagentStart,
  'file-edited': fileEdited,
  'skill-used': skillUsed,
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
  'question-answered': questionAnswered,
  'ask-question': askQuestion,
};
