/**
 * Auto-amélioration contrôlée. Une leçon n'est candidate à devenir une règle/skill que si
 * elle est confirmée sur plusieurs tâches distinctes ou adossée à une source primaire.
 */

export type LearningKind = 'worked' | 'failed' | 'recurring-error' | 'effective-decision' | 'procedure';

export interface Learning {
  id: string;
  at: string;
  taskId?: string;
  kind: LearningKind;
  /** Clé de regroupement normalisée (ex. "prisma-migration-shadow-db"). */
  topic: string;
  lesson: string;
  evidence?: string;
  /** Source primaire (doc officielle, RFC…) : suffit à rendre la leçon fiable. */
  source?: string;
  skill?: string;
}

export interface PromotionCandidate {
  topic: string;
  occurrences: number;
  distinctTasks: number;
  lessons: string[];
  sources: string[];
  targetSkill?: string;
  justification: string;
}

export function normalizeTopic(topic: string): string {
  return topic
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function promotionCandidates(learnings: readonly Learning[], minDistinctTasks = 3): PromotionCandidate[] {
  const groups = new Map<string, Learning[]>();
  for (const l of learnings) {
    const key = normalizeTopic(l.topic);
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const out: PromotionCandidate[] = [];
  for (const [topic, list] of groups) {
    const distinctTasks = new Set(list.map((l) => l.taskId ?? l.id)).size;
    const sources = [...new Set(list.map((l) => l.source).filter((s): s is string => Boolean(s)))];
    const repeated = distinctTasks >= minDistinctTasks;
    if (!repeated && sources.length === 0) continue;
    const skills = list.map((l) => l.skill).filter((s): s is string => Boolean(s));
    out.push({
      topic,
      occurrences: list.length,
      distinctTasks,
      lessons: [...new Set(list.map((l) => l.lesson))],
      sources,
      ...(skills.length > 0 ? { targetSkill: mostFrequent(skills) } : {}),
      justification: repeated
        ? `Observé sur ${distinctTasks} tâches distinctes (seuil ${minDistinctTasks}).`
        : `Adossé à une source primaire (${sources.join(', ')}), observé ${distinctTasks} fois.`,
    });
  }
  return out.sort((a, b) => b.distinctTasks - a.distinctTasks);
}

function mostFrequent(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}
