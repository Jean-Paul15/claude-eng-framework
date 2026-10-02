import * as path from 'node:path';
import { classifyCommand, classifyFileWrite } from '../domain/guardrails.js';
import { matchesAny, normalizePath } from '../domain/globs.js';
import { resumeBrief } from '../brain/brief.js';
import type { BrainStore } from '../brain/store.js';
import { createCheckpoint } from '../app/checkpoints.js';
import { completionCheck } from '../app/tasks.js';
import { CLI_INVOCATION } from '../brain/paths.js';

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
  });
  store.log({ type: 'session.start', ...(input.session_id ? { sessionId: input.session_id } : {}), data: { source } });
  return { exitCode: 0, json: { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: resumeBrief(store, source) } } };
}

export function guardCommand(store: BrainStore, input: HookInput): HookOutput {
  const command = String(input.tool_input?.['command'] ?? '');
  if (!command) return OK;
  const config = store.config();
  const protectedBranches = store.profile()?.git.protectedBranches ?? ['main', 'master'];
  const verdict = classifyCommand(command, { autonomy: config.policy.autonomy, protectedBranches });
  if (verdict.class === 'autonomous') return OK;
  store.log({ type: 'guard.verdict', ...ids(input), data: { tool: input.tool_name, class: verdict.class, rule: verdict.rule } });
  return verdict.class === 'forbidden'
    ? preToolDecision('deny', `Action interdite (${verdict.rule}) : ${verdict.reason} Proposer une alternative sûre ou demander à l'humain d'agir lui-même.`)
    : preToolDecision('ask', `Approbation humaine requise (${verdict.rule}) : ${verdict.reason}`);
}

export function guardFile(store: BrainStore, input: HookInput): HookOutput {
  const raw = String(input.tool_input?.['file_path'] ?? input.tool_input?.['notebook_path'] ?? '');
  if (!raw) return OK;
  const rel = relativeToProject(store, raw);
  if (rel.startsWith('..')) return OK; // hors projet : laissé aux permissions natives
  const config = store.config();
  const verdict = classifyFileWrite(rel, config.policy.autonomy);
  if (verdict.class !== 'autonomous') {
    store.log({ type: 'guard.verdict', ...ids(input), data: { file: rel, class: verdict.class, rule: verdict.rule } });
    return verdict.class === 'forbidden' ? preToolDecision('deny', `${verdict.reason} (${rel})`) : preToolDecision('ask', `${verdict.reason} (${rel})`);
  }
  // Prévention de conflit : un worker ne modifie pas un fichier possédé par une autre tâche en cours.
  if (input.agent_id) {
    const state = store.state();
    const myTask = state.agentTasks?.[input.agent_id];
    if (myTask) {
      const tasks = store.tasks();
      const mine = tasks.find((t) => t.id === myTask);
      const inMyScope = mine && mine.files.length > 0 && matchesAny(rel, mine.files);
      const owner = tasks.find((t) => t.id !== myTask && t.status === 'in_progress' && t.files.length > 0 && matchesAny(rel, t.files));
      if (owner && !inMyScope) {
        store.log({ type: 'conflict.detected', ...ids(input), taskId: myTask, data: { file: rel, owner: owner.id, prevented: true } });
        return preToolDecision('deny', `${rel} appartient à la tâche en cours ${owner.id}. Ne pas l'éditer : décrire le changement nécessaire dans ton rapport (ou message au propriétaire en Agent Team).`);
      }
    }
  }
  return OK;
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
  let taskId: string | undefined;
  store.updateState((s) => {
    const pending = s.pendingSpawns ?? [];
    const i = pending.findIndex((p) => p.agentType === input.agent_type);
    if (i >= 0) {
      taskId = pending[i]!.taskId;
      pending.splice(i, 1);
      s.pendingSpawns = pending;
      s.agentTasks = { ...(s.agentTasks ?? {}), [input.agent_id!]: taskId };
    }
  });
  store.log({ type: 'agent.spawn', ...ids(input), ...(taskId ? { taskId } : {}), data: { phase: 'started' } });
  return OK;
}

export function fileEdited(store: BrainStore, input: HookInput): HookOutput {
  const raw = String(input.tool_input?.['file_path'] ?? input.tool_input?.['notebook_path'] ?? '');
  if (!raw) return OK;
  const rel = relativeToProject(store, raw);
  if (rel.startsWith('.ceng/')) return OK;
  const state = store.updateState((s) => {
    s.editsSinceCheckpoint += 1;
  });
  const taskId = (input.agent_id && state.agentTasks?.[input.agent_id]) || state.currentTask;
  store.log({ type: 'file.edited', ...ids(input), ...(taskId ? { taskId } : {}), data: { file: rel, tool: input.tool_name } });
  return OK;
}

export function skillUsed(store: BrainStore, input: HookInput): HookOutput {
  const skill = String(input.tool_input?.['skill'] ?? input.tool_input?.['name'] ?? '');
  if (skill) store.log({ type: 'skill.used', ...ids(input), data: { skill } });
  return OK;
}

export function subagentStop(store: BrainStore, input: HookInput): HookOutput {
  const agentType = input.agent_type ?? '';
  const taskId = input.agent_id ? store.state().agentTasks?.[input.agent_id] : undefined;
  const message = String(input.last_assistant_message ?? '');
  const hasReport = message.includes(REPORT_MARKER);
  store.log({ type: 'agent.stop', ...ids(input), ...(taskId ? { taskId } : {}), data: { hasReport } });
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
  if (input.agent_id || input.stop_hook_active) return OK;
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
};
