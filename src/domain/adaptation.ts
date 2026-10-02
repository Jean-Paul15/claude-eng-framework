import type { FrameworkEvent } from './events.js';
import type { AdaptiveOverrides, EffectivePolicy, Task, TaskKind } from './types.js';

/**
 * Adaptation autonome bornée : le framework ajuste sa stratégie à partir de son propre journal.
 * Règle d'or : aucune adaptation sans échantillon minimal (une expérience isolée n'est jamais une règle),
 * chaque ajustement est expliqué, et aucun ne peut abaisser un plancher critique.
 */

export interface AdaptationInput {
  events: readonly FrameworkEvent[];
  tasks: readonly Task[];
  policy: EffectivePolicy;
  installedSkills: readonly string[];
  minSample?: number;
  now?: string;
}

export interface AdaptationResult {
  overrides: AdaptiveOverrides;
  recommendations: string[];
  /** Skills jamais utilisées sur un nombre suffisant de sessions : candidates à `skillOverrides: name-only`. */
  dormantSkills: string[];
  stats: Record<string, number | string>;
}

const rate = (num: number, den: number) => (den === 0 ? 0 : num / den);
const pct = (r: number) => `${Math.round(r * 100)} %`;

export function adapt(input: AdaptationInput): AdaptationResult {
  const min = input.minSample ?? 5;
  const reasons: string[] = [];
  const recommendations: string[] = [];
  const overrides: AdaptiveOverrides = { reasons, updatedAt: input.now ?? new Date().toISOString() };
  const stats: Record<string, number | string> = {};
  const done = input.tasks.filter((t) => t.status === 'done' || t.status === 'failed');

  // 1. Conflits en parallèle → réduire le parallélisme
  const parallelPlans = input.events.filter(
    (e) => e.type === 'plan.computed' && Array.isArray(e.data?.['modes']) && (e.data!['modes'] as string[]).some((m) => m === 'parallel-subagents' || m === 'agent-team'),
  ).length;
  const conflicts = input.events.filter((e) => e.type === 'conflict.detected').length;
  stats['parallelPlans'] = parallelPlans;
  stats['conflicts'] = conflicts;
  if (parallelPlans >= min && rate(conflicts, parallelPlans) > 0.2) {
    overrides.maxParallel = Math.max(1, input.policy.maxParallel - 1);
    reasons.push(`Conflits dans ${pct(rate(conflicts, parallelPlans))} des lots parallèles (${conflicts}/${parallelPlans}) : parallélisme réduit à ${overrides.maxParallel} ; revoir la découpe (périmètres de fichiers).`);
  }

  // 2. Échecs de gates au premier passage, par modèle d'implémentation
  const failedGateTasks = new Set(input.events.filter((e) => e.type === 'gate.result' && e.data?.['status'] === 'fail').map((e) => e.taskId));
  const haikuTasks = done.filter((t) => t.route?.implementer.model === 'haiku');
  const haikuFail = haikuTasks.filter((t) => failedGateTasks.has(t.id)).length;
  stats['haikuTasks'] = haikuTasks.length;
  if (haikuTasks.length >= min && rate(haikuFail, haikuTasks.length) > 0.4) {
    overrides.disableHaikuImplementation = true;
    reasons.push(`Haiku échoue aux gates sur ${pct(rate(haikuFail, haikuTasks.length))} des tâches mécaniques : implémentation remontée à Sonnet.`);
  }

  // 3. Par kind : échecs de gates répétés → revue plus profonde ; escalades fréquentes → conception Opus plus tôt
  const byKind = new Map<TaskKind, Task[]>();
  for (const t of done) byKind.set(t.kind, [...(byKind.get(t.kind) ?? []), t]);
  const escalatedTasks = new Set(input.events.filter((e) => e.type === 'escalation.opened').map((e) => e.taskId));
  for (const [kind, list] of byKind) {
    if (list.length < min) continue;
    const failRate = rate(list.filter((t) => failedGateTasks.has(t.id)).length, list.length);
    const escRate = rate(list.filter((t) => escalatedTasks.has(t.id)).length, list.length);
    stats[`failRate.${kind}`] = pct(failRate);
    stats[`escalationRate.${kind}`] = pct(escRate);
    if (failRate > 0.4) {
      overrides.reviewBump = { ...(overrides.reviewBump ?? {}), [kind]: 1 };
      reasons.push(`Les tâches « ${kind} » échouent aux gates dans ${pct(failRate)} des cas : revue relevée d'un niveau.`);
    }
    if (escRate > 0.3) {
      overrides.opusDesignKinds = [...(overrides.opusDesignKinds ?? []), kind];
      reasons.push(`Les tâches « ${kind} » escaladent vers Opus dans ${pct(escRate)} des cas : phase de conception Opus ajoutée d'emblée (moins cher que deux échecs Sonnet).`);
    }
    if (failRate === 0 && escRate === 0 && list.every((t) => t.route?.reviewLevel === 'thorough') && input.policy.budget === 'economy') {
      recommendations.push(`Les revues « thorough » des tâches « ${kind} » n'ont jamais trouvé de défaut bloquant sur ${list.length} tâches : envisager reviewPolicy « minimal » pour ce type (hors domaines critiques).`);
    }
  }

  // 4. Skills dormantes → ne plus charger leur description
  const sessions = input.events.filter((e) => e.type === 'session.start').length;
  const used = new Set(input.events.filter((e) => e.type === 'skill.used').map((e) => String(e.data?.['skill'] ?? '')));
  stats['sessions'] = sessions;
  const dormantSkills = sessions >= min * 2 ? input.installedSkills.filter((s) => !used.has(s) && !s.startsWith('ceng-')) : [];
  if (dormantSkills.length > 0) {
    recommendations.push(`${dormantSkills.length} skill(s) jamais utilisée(s) sur ${sessions} sessions : passer leur visibilité en « name-only » réduit le contexte permanent (${dormantSkills.join(', ')}).`);
  }

  if (reasons.length === 0) recommendations.push(`Aucun ajustement : échantillons insuffisants (min ${min}) ou indicateurs sains.`);
  return { overrides, recommendations, dormantSkills, stats };
}
