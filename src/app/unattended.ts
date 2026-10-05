import * as path from 'node:path';
import { readyTasks } from '../domain/taskgraph.js';
import { appendLine, exists, readText } from '../infra/fs.js';
import type { BrainStore } from '../brain/store.js';
import { CLI_INVOCATION } from '../brain/paths.js';
import { currentDelegation } from './delegation.js';

/**
 * Mode sans humain (« mode nuit ») : rien n'attend jamais une réponse humaine.
 *  - une action qui exigerait une approbation est refusée proprement et consignée pour le réveil ;
 *  - l'orchestrateur enchaîne les tâches tant qu'il en reste de faisables et qu'il progresse.
 * Activé par la variable CENG_UNATTENDED=1 (posée par `ceng run --unattended`).
 */

export const MAX_CONTINUES = 300;
export const MAX_STALLS = 3;

export function isUnattended(): boolean {
  return process.env['CENG_UNATTENDED'] === '1';
}

export function pendingApprovalsPath(store: BrainStore): string {
  return path.join(store.paths.brain, 'pending-approvals.md');
}

/** Consigne une action refusée faute d'humain, pour validation au réveil. */
export function recordPendingApproval(store: BrainStore, what: string, reason: string): void {
  const file = pendingApprovalsPath(store);
  if (!exists(file)) appendLine(file, '# Actions en attente de validation humaine\n\n_Refusées pendant un travail sans humain. Valider, puis demander à Claude de les reprendre._\n');
  const task = store.state().currentTask;
  appendLine(file, `- [ ] ${new Date().toISOString()}${task ? ` · ${task}` : ''} · \`${what.replace(/`/g, "'").slice(0, 200)}\` — ${reason}`);
  store.log({ type: 'guard.verdict', ...(task ? { taskId: task } : {}), data: { class: 'deferred-to-human', what: what.slice(0, 120), reason } });
}

export function pendingApprovalsCount(store: BrainStore): number {
  return (readText(pendingApprovalsPath(store)) ?? '').split(/\r?\n/).filter((l) => l.startsWith('- [ ]')).length;
}

/** Message renvoyé à Claude quand une action est différée : il ne doit ni attendre ni réessayer. */
export function deferredReason(reason: string): string {
  return `${reason} — MODE SANS HUMAIN : personne ne peut approuver maintenant. Action consignée dans .ceng/brain/pending-approvals.md. ` +
    `Ne pas réessayer ni contourner : continuer autrement si c'est possible, sinon \`${CLI_INVOCATION} task block <id> --reason "attend validation humaine"\` puis passer aux tâches indépendantes.`;
}

/**
 * Signature de progression : change quand une tâche change d'état, qu'un rapport de sous-agent arrive ou qu'un checkpoint
 * VOLONTAIRE est pris. Les simples écritures de fichiers des sous-agents et les instantanés automatiques (avant
 * suppression, avant compaction) ne comptent pas : ils se produisent aussi quand l'orchestrateur tourne en rond.
 */
function progressSignature(store: BrainStore): string {
  const byStatus = store.tasks().map((t) => `${t.id}:${t.status}:${t.attempts.length}`).join('|');
  const lastDeliberate = store.checkpoints().filter((c) => !c.auto).pop();
  return `${byStatus}#${lastDeliberate?.id ?? ''}#${store.listDir(store.paths.reports).length}`;
}

export interface ContinueDecision {
  continue: boolean;
  reason: string;
}

/** Faut-il empêcher l'orchestrateur de s'arrêter (il reste du travail faisable et il progresse) ? */
export function shouldKeepWorking(store: BrainStore): ContinueDecision {
  const tasks = store.tasks();
  const ready = readyTasks(tasks);
  const inProgress = tasks.filter((t) => t.status === 'in_progress');
  if (ready.length === 0 && inProgress.length === 0) {
    return { continue: false, reason: tasks.length === 0 ? 'aucune tâche' : 'plus aucune tâche faisable (terminées ou bloquées)' };
  }
  // Tout ce qui est faisable est déjà confié à des sous-agents en cours (ou la limite de parallélisme est atteinte) :
  // la fin de l'un d'eux réveillera l'orchestrateur. Le relancer maintenant ne ferait que consommer des tokens à attendre.
  const delegation = currentDelegation(store, inProgress);
  const undelegated = inProgress.filter((t) => !delegation.tasks.has(t.id));
  const covered = undelegated.length <= delegation.unattached;
  const limit = Math.max(1, store.config().policy.maxParallel);
  if (delegation.running >= limit) {
    return { continue: false, reason: `limite de parallélisme atteinte (${delegation.running}/${limit} sous-agents) ; la fin de l'un d'eux relancera l'orchestrateur` };
  }
  if (inProgress.length > 0 && covered && ready.length === 0) {
    return { continue: false, reason: 'tout le travail faisable est chez des sous-agents en cours ; leur fin relancera l\'orchestrateur' };
  }
  const state = store.state();
  const u = state.unattended ?? { continues: 0, lastSignature: '', stalls: 0 };
  const signature = progressSignature(store);
  const stalls = signature === u.lastSignature ? u.stalls + 1 : 0;
  if (u.continues >= MAX_CONTINUES) return { continue: false, reason: `limite de ${MAX_CONTINUES} relances atteinte` };
  if (stalls >= MAX_STALLS) return { continue: false, reason: `aucune progression sur ${MAX_STALLS} relances (bloquer ce qui l'est et s'arrêter)` };
  store.updateState((s) => {
    s.unattended = { continues: u.continues + 1, lastSignature: signature, stalls };
  });
  const next = undelegated[0] ?? ready[0] ?? inProgress[0]!;
  return { continue: true, reason: `il reste du travail faisable (prochaine : ${next.id} ${next.title})` };
}
