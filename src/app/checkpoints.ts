import { nextId } from '../domain/taskgraph.js';
import { Git } from '../infra/git.js';
import type { BrainStore, CheckpointRecord } from '../brain/store.js';

/**
 * Checkpoints : état narratif (fait / prochaine étape / échec) + instantané git non destructif.
 * La reprise ne dépend jamais de la conversation.
 */

export interface CheckpointInput {
  taskId?: string;
  done: string;
  next: string;
  failed?: string;
  notes?: string;
  snapshot?: boolean;
  auto?: boolean;
}

export function createCheckpoint(store: BrainStore, input: CheckpointInput): CheckpointRecord {
  const git = new Git(store.paths.root);
  const id = nextId('CP', store.checkpoints().map((c) => c.id));
  const isRepo = git.isRepo();
  const head = isRepo ? git.head() : undefined;
  let snapshot: string | undefined;
  if (isRepo && input.snapshot !== false) {
    snapshot = git.snapshot(`refs/ceng/checkpoints/${id}`, `ceng checkpoint ${id}${input.taskId ? ` (${input.taskId})` : ''}: ${input.done}`.slice(0, 200));
  }
  const taskId = input.taskId ?? store.state().currentTask;
  const cp: CheckpointRecord = {
    id,
    at: new Date().toISOString(),
    ...(taskId ? { taskId } : {}),
    done: input.done,
    next: input.next,
    ...(input.failed ? { failed: input.failed } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    ...(head ? { head } : {}),
    ...(snapshot ? { snapshot } : {}),
    auto: input.auto ?? false,
  };
  store.appendCheckpoint(cp);
  store.updateState((s) => {
    s.lastCheckpoint = cp;
    s.editsSinceCheckpoint = 0;
  });
  store.log({ type: 'checkpoint', ...(taskId ? { taskId } : {}), data: { id, auto: cp.auto, snapshot: Boolean(snapshot), next: cp.next } });
  return cp;
}

export interface RollbackPlan {
  checkpoint: CheckpointRecord;
  changedFiles: string[];
  diffStat: string;
}

export function planRollback(store: BrainStore, checkpointId: string): RollbackPlan {
  const cp = store.checkpoints().find((c) => c.id === checkpointId.toUpperCase());
  if (!cp) throw new Error(`Checkpoint ${checkpointId} introuvable (voir \`ceng checkpoint list\`).`);
  if (!cp.snapshot) throw new Error(`${cp.id} n'a pas d'instantané git (dépôt absent ou --no-snapshot) : rollback automatique impossible.`);
  const git = new Git(store.paths.root);
  if (!git.hasCommit(cp.snapshot)) {
    // Les instantanés sont des références git locales (refs/ceng/…), non poussées : un clone ne les a pas.
    throw new Error(`L'instantané de ${cp.id} n'existe pas dans ce dépôt (créé sur une autre machine ou un autre clone). Utiliser l'historique git (commits) pour revenir en arrière.`);
  }
  return { checkpoint: cp, changedFiles: git.filesChangedSince(cp.snapshot), diffStat: git.diffStat(cp.snapshot) };
}

/**
 * Restaure un checkpoint. Ne détruit jamais silencieusement le travail : un instantané de sécurité
 * de l'état courant est pris d'abord, et son identifiant est renvoyé pour annuler le rollback.
 */
export function applyRollback(store: BrainStore, checkpointId: string): { safety: CheckpointRecord; createdKept: string[] } {
  const plan = planRollback(store, checkpointId);
  const safety = createCheckpoint(store, {
    ...(plan.checkpoint.taskId ? { taskId: plan.checkpoint.taskId } : {}),
    done: `Instantané de sécurité avant rollback vers ${plan.checkpoint.id}`,
    next: `Annulable via \`ceng rollback <ce checkpoint> --apply\``,
    auto: true,
  });
  if (!safety.snapshot) throw new Error('Impossible de créer l\'instantané de sécurité : rollback annulé (rien n\'a été modifié).');
  const result = new Git(store.paths.root).restoreSnapshot(plan.checkpoint.snapshot!);
  if (!result.ok) throw new Error(`Échec de la restauration : ${result.error}. L'état courant est sauvegardé dans ${safety.id}.`);
  store.log({ type: 'rollback', ...(plan.checkpoint.taskId ? { taskId: plan.checkpoint.taskId } : {}), data: { to: plan.checkpoint.id, safety: safety.id, files: plan.changedFiles.length } });
  return { safety, createdKept: result.created };
}
