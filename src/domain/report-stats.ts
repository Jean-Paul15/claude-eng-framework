import type { GateStatus, ModelTier, Task, TaskStatus } from './types.js';

/**
 * Chiffres du tableau de bord, calculés à partir des seules tâches (fonctions pures : aucune lecture de disque).
 * Une tâche annulée n'est comptée nulle part : elle ne dit rien de l'avancement.
 */

export const LIVE_STATUSES = ['done', 'in_progress', 'pending', 'blocked', 'failed'] as const satisfies readonly TaskStatus[];
export type LiveStatus = (typeof LIVE_STATUSES)[number];

const live = (tasks: readonly Task[]): Task[] => tasks.filter((t) => t.status !== 'cancelled');

export function statusCounts(tasks: readonly Task[]): Record<LiveStatus, number> {
  const out = { done: 0, in_progress: 0, pending: 0, blocked: 0, failed: 0 };
  for (const t of live(tasks)) out[t.status as LiveStatus] += 1;
  return out;
}

export interface GroupProgress {
  group: string;
  done: number;
  total: number;
}

/**
 * Avancement par chantier (groupe de tâches), du plus chargé au moins chargé. Quand le projet n'a pas (ou presque pas) de groupes —
 * moins de trois —, le regroupement se fait par type de tâche, pour que le relief reste parlant ; `by` dit lequel a été retenu.
 */
export function groupProgress(tasks: readonly Task[]): { by: 'chantier' | 'type'; rows: GroupProgress[] } {
  const named = new Set(live(tasks).map((t) => t.group?.trim()).filter(Boolean));
  const by: 'chantier' | 'type' = named.size >= 3 ? 'chantier' : 'type';
  return { by, rows: tally(tasks, (t) => (by === 'chantier' ? t.group?.trim() || 'Sans groupe' : t.kind)) };
}

function tally(tasks: readonly Task[], keyOf: (t: Task) => string): GroupProgress[] {
  const by = new Map<string, GroupProgress>();
  for (const t of live(tasks)) {
    const group = keyOf(t);
    const g = by.get(group) ?? { group, done: 0, total: 0 };
    g.total += 1;
    if (t.status === 'done') g.done += 1;
    by.set(group, g);
  }
  return [...by.values()].sort((a, b) => b.total - a.total || a.group.localeCompare(b.group));
}

export interface GateTally {
  gate: string;
  pass: number;
  fail: number;
  waived: number;
  other: number;
}

/** Résultat le plus récent de chaque contrôle qualité, par tâche : combien passent, échouent, sont dispensés. */
export function gateTallies(tasks: readonly Task[]): GateTally[] {
  const by = new Map<string, GateTally>();
  for (const t of live(tasks)) {
    for (const g of t.gates) {
      const row = by.get(g.gate) ?? { gate: g.gate, pass: 0, fail: 0, waived: 0, other: 0 };
      const status: GateStatus = g.status;
      if (status === 'pass') row.pass += 1;
      else if (status === 'fail') row.fail += 1;
      else if (status === 'waived') row.waived += 1;
      else row.other += 1;
      by.set(g.gate, row);
    }
  }
  return [...by.values()].sort((a, b) => b.pass + b.fail + b.waived + b.other - (a.pass + a.fail + a.waived + a.other) || a.gate.localeCompare(b.gate));
}

export interface Bucket {
  /** Début de la période (AAAA-MM-JJ). */
  start: string;
  count: number;
}

const DAY = 86_400_000;
const dayOf = (iso: string): number => Math.floor(Date.parse(iso.slice(0, 10)) / DAY);
const isoDay = (n: number): string => new Date(n * DAY).toISOString().slice(0, 10);

/**
 * Tâches terminées par jour (par semaine au-delà de 45 jours, pour rester lisible), zéros compris entre la première et la dernière.
 * La date d'une tâche terminée est sa dernière mise à jour.
 */
export function doneOverTime(tasks: readonly Task[]): { unit: 'jour' | 'semaine'; buckets: Bucket[] } {
  const days = live(tasks).filter((t) => t.status === 'done' && Number.isFinite(Date.parse(t.updatedAt))).map((t) => dayOf(t.updatedAt));
  if (!days.length) return { unit: 'jour', buckets: [] };
  const first = Math.min(...days);
  const last = Math.max(...days);
  const weekly = last - first > 45;
  const step = weekly ? 7 : 1;
  const counts = new Map<number, number>();
  for (const d of days) {
    const key = first + Math.floor((d - first) / step) * step;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const buckets: Bucket[] = [];
  for (let d = first; d <= last; d += step) buckets.push({ start: isoDay(d), count: counts.get(d) ?? 0 });
  return { unit: weekly ? 'semaine' : 'jour', buckets };
}

/** Tentatives par modèle (à titre d'activité : opus, sonnet, haiku). */
export function attemptsByModel(tasks: readonly Task[]): Record<ModelTier, number> {
  const out: Record<ModelTier, number> = { opus: 0, sonnet: 0, haiku: 0 };
  for (const t of live(tasks)) for (const a of t.attempts) if (a.model in out) out[a.model] += 1;
  return out;
}
