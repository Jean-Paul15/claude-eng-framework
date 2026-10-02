import { fileSetsOverlap } from './globs.js';
import { isTrivial } from './routing.js';
import { dependentCounts, readyTasks } from './taskgraph.js';
import type { AdaptiveOverrides, EffectivePolicy, ExecutionPlan, PlannedBatch, Task } from './types.js';

/**
 * Planificateur de parallélisme.
 * Ordre de préférence (du moins coûteux au plus coûteux) :
 *   direct → séquentiel → subagents parallèles → Agent Team.
 * On ne monte d'un cran que si le gain attendu dépasse le coût de coordination.
 */

export interface PlannerContext {
  policy: EffectivePolicy;
  overrides?: AdaptiveOverrides;
  /** Session interactive avec Agent Teams activées (les teams n'existent pas en `claude -p`). */
  teamsAvailable: boolean;
}

/** Un lot parallèle ne vaut le coût de démarrage de plusieurs agents que si les tâches sont substantielles. */
function substantial(t: Task): boolean {
  return t.assessment.complexity >= 2 || t.assessment.contextSize !== 'S';
}

function sharesInterface(batch: readonly Task[]): boolean {
  const seen = new Map<string, number>();
  for (const t of batch) for (const i of t.interfaces) seen.set(i, (seen.get(i) ?? 0) + 1);
  return [...seen.values()].some((n) => n >= 2);
}

export function planExecution(tasks: readonly Task[], ctx: PlannerContext): ExecutionPlan {
  const reasons: string[] = [];
  const deferred: ExecutionPlan['deferred'] = [];
  const batches: PlannedBatch[] = [];
  const ready = readyTasks(tasks);
  if (ready.length === 0) {
    const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
    reasons.push(inProgress > 0 ? `${inProgress} tâche(s) en cours ; aucune nouvelle tâche prête.` : 'Aucune tâche prête (graphe terminé ou bloqué).');
    return { batches, deferred, reasons };
  }

  const priority = dependentCounts(tasks);
  const ordered = [...ready].sort(
    (x, y) =>
      (priority.get(y.id) ?? 0) - (priority.get(x.id) ?? 0) ||
      y.assessment.risk - x.assessment.risk ||
      x.id.localeCompare(y.id),
  );

  // Les tâches triviales sont faites directement : lancer un agent pour elles coûterait plus que le travail.
  const trivial = ordered.filter(isTrivial);
  if (trivial.length > 0) {
    batches.push({ mode: 'direct', tasks: trivial.map((t) => t.id), isolation: 'none', reasons: ['Tâches triviales : exécution directe par l\'orchestrateur.'] });
  }
  const rest = ordered.filter((t) => !isTrivial(t));
  if (rest.length === 0) return { batches, deferred, reasons };

  const maxParallel = Math.max(1, Math.min(ctx.policy.maxParallel, ctx.overrides?.maxParallel ?? Number.POSITIVE_INFINITY));
  if (ctx.policy.parallelism === 'off' || maxParallel === 1) {
    reasons.push(ctx.policy.parallelism === 'off' ? 'Parallélisme désactivé par la politique.' : 'Parallélisme réduit à 1 (adaptation après conflits).');
    batches.push({ mode: 'sequential', tasks: [rest[0]!.id], isolation: 'none', reasons: ['Tâche prioritaire (chemin critique).'] });
    for (const t of rest.slice(1)) deferred.push({ task: t.id, reason: 'exécution séquentielle' });
    return { batches, deferred, reasons };
  }

  // Sélection gloutonne d'un lot sans recouvrement de fichiers.
  const batch: Task[] = [];
  for (const t of rest) {
    if (batch.length >= maxParallel) {
      deferred.push({ task: t.id, reason: `limite de parallélisme (${maxParallel})` });
      continue;
    }
    if (t.files.length === 0) {
      // Périmètre inconnu : on ne peut prouver l'absence de conflit. Admis seulement en tête de lot,
      // et alors le lot entier passe en worktrees isolés.
      if (batch.length === 0) batch.push(t);
      else deferred.push({ task: t.id, reason: 'périmètre de fichiers non déclaré (risque de conflit)' });
      continue;
    }
    const conflict = batch.find((b) => b.files.length > 0 && fileSetsOverlap(b.files, t.files));
    if (conflict) {
      deferred.push({ task: t.id, reason: `fichiers en recouvrement avec ${conflict.id}` });
      continue;
    }
    batch.push(t);
  }

  const parallelCandidates = batch.filter(substantial);
  if (batch.length === 1 || parallelCandidates.length < 2) {
    if (batch.length > 1) reasons.push('Gain du parallélisme insuffisant (tâches trop petites) : exécution séquentielle.');
    batches.push({ mode: 'sequential', tasks: [batch[0]!.id], isolation: 'none', reasons: ['Prochaine tâche du chemin critique.'] });
    for (const t of batch.slice(1)) deferred.push({ task: t.id, reason: 'séquentiel (gain parallèle insuffisant)' });
    return { batches, deferred, reasons };
  }

  const isolation = batch.some((t) => t.files.length === 0) ? 'worktree' : 'none';
  const coordination = sharesInterface(batch);
  const teamOk =
    ctx.policy.parallelism === 'teams' &&
    ctx.teamsAvailable &&
    ctx.policy.budget !== 'economy' &&
    batch.length >= 3 &&
    coordination;

  if (teamOk) {
    reasons.push(`${batch.length} tâches indépendantes en fichiers mais partageant un contrat : Agent Team (coordination directe entre agents).`);
    batches.push({ mode: 'agent-team', tasks: batch.map((t) => t.id), isolation: 'none', reasons: ['Charte d\'équipe obligatoire ; propriété de fichiers par teammate.'] });
  } else {
    const why: string[] = [`${batch.length} tâches sans recouvrement de fichiers : subagents parallèles (résumés seulement dans le contexte principal).`];
    if (coordination) why.push('Contrat partagé : le contrat est figé avant le lancement (ou Agent Team si disponibles).');
    if (ctx.policy.parallelism === 'teams' && !teamOk) why.push('Agent Team non retenue (critères : ≥ 3 tâches, contrat partagé, interactif, budget ≠ economy).');
    reasons.push(...why);
    batches.push({ mode: 'parallel-subagents', tasks: batch.map((t) => t.id), isolation, reasons: isolation === 'worktree' ? ['Une tâche sans périmètre déclaré : worktree isolé.'] : [] });
  }
  return { batches, deferred, reasons };
}
