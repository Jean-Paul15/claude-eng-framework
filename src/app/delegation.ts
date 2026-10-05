import type { Task } from '../domain/types.js';
import { readJsonLinesTail } from '../infra/fs.js';
import type { FrameworkEvent } from '../domain/events.js';
import type { BrainStore } from '../brain/store.js';

/**
 * Travail confié à des sous-agents en cours : de quoi décider que l'orchestrateur n'a rien à faire en attendant.
 * Deux sources, car aucune n'est fiable seule :
 *  - l'état (`runningAgents`, rempli par SubagentStart, vidé par SubagentStop) — ne connaît pas les agents lancés
 *    avant la mise à jour ni ceux dont le démarrage n'a pas pu être rattaché à une tâche (valeur vide) ;
 *  - le journal : une tâche en cours dont un `agent.spawn` récent n'a pas d'`agent.stop` correspondant est déléguée
 *    (couvre les agents lancés avant la mise à jour du framework).
 * Tout expire (un agent n'est jamais « en cours » indéfiniment : arrêt jamais signalé, session interrompue).
 */

export const DELEGATION_TTL_MS = 60 * 60_000;

export interface Delegation {
  /** Tâches en cours confiées à un sous-agent. */
  tasks: Set<string>;
  /** Sous-agents démarrés mais rattachés à aucune tâche. */
  unattached: number;
  /** Nombre de sous-agents actifs (tâches déléguées + non rattachés). */
  running: number;
}

function fromState(store: BrainStore, now: number): { tasks: Set<string>; unattached: number } {
  const state = store.state();
  const tasks = new Set<string>();
  let unattached = 0;
  for (const [agentId, taskId] of Object.entries(state.runningAgents ?? {})) {
    const startedAt = state.agentStartedAt?.[agentId];
    if (startedAt && now - Date.parse(startedAt) > DELEGATION_TTL_MS) continue;
    if (taskId) tasks.add(taskId);
    else unattached++;
  }
  return { tasks, unattached };
}

/**
 * Tâches dont les lancements récents dépassent les arrêts. Un lancement (PreToolUse de l'outil Agent, sans `phase`)
 * est apparié à un arrêt de la même tâche ; un arrêt sans tâche (agent jamais rattaché) l'est au plus ancien lancement
 * du même type d'agent.
 */
function fromJournal(store: BrainStore, inProgress: readonly Task[], now: number): Set<string> {
  const open: { taskId: string; agentType: string | undefined }[] = [];
  for (const e of readJsonLinesTail<FrameworkEvent>(store.paths.events)) {
    if (now - Date.parse(e.ts) > DELEGATION_TTL_MS) continue;
    if (e.type === 'agent.spawn' && e.taskId && !e.data?.['phase']) open.push({ taskId: e.taskId, agentType: e.agentType });
    else if (e.type === 'agent.stop') {
      const i = open.findIndex((o) => (e.taskId ? o.taskId === e.taskId : o.agentType === e.agentType));
      if (i >= 0) open.splice(i, 1);
    }
  }
  const pending = new Set(open.map((o) => o.taskId));
  return new Set(inProgress.filter((t) => pending.has(t.id)).map((t) => t.id));
}

export function currentDelegation(store: BrainStore, inProgress: readonly Task[], now = Date.now()): Delegation {
  const state = fromState(store, now);
  const inProgressIds = new Set(inProgress.map((t) => t.id));
  const tasks = new Set([...state.tasks].filter((id) => inProgressIds.has(id)));
  for (const id of fromJournal(store, inProgress, now)) tasks.add(id);
  return { tasks, unattached: state.unattached, running: tasks.size + state.unattached };
}
