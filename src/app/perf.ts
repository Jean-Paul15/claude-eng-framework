import { readJson, writeJsonAtomic } from '../infra/fs.js';
import type { BrainStore } from '../brain/store.js';

/**
 * Budgets de performance avec référence : la commande `performance` du projet écrit des lignes `clé=valeur` (taille du bundle en ko,
 * temps de démarrage en ms, p95 d'un point d'entrée, nombre de requêtes SQL d'un parcours…). Une mesure qui se dégrade de plus de la
 * tolérance par rapport à la référence fait échouer la gate ; une première mesure ou une amélioration devient la nouvelle référence.
 * Plus petit = mieux. Budget absolu optionnel : `perfBudgets` de la configuration.
 */

export interface Baseline {
  value: number;
  at: string;
  task?: string;
}
export type BaselineFile = Record<string, Baseline>;

export const DEFAULT_TOLERANCE_PCT = 10;
const file = (store: BrainStore) => `${store.paths.brain}/perf-baseline.json`;
export const readBaseline = (store: BrainStore): BaselineFile => readJson<BaselineFile>(file(store)) ?? {};

/** Lignes `clé=valeur` (valeur numérique) d'une sortie de commande. */
export function parseMetrics(stdout: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of stdout.matchAll(/^\s*([A-Za-z][\w.-]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*$/gm)) out[m[1]!] = Number(m[2]);
  return out;
}

export interface PerfResult {
  ok: boolean;
  lines: string[];
  next: BaselineFile;
}

export function comparePerf(baseline: BaselineFile, metrics: Record<string, number>, tolerancePct: number, budgets: Record<string, number> = {}, task?: string, now = new Date().toISOString()): PerfResult {
  const lines: string[] = [];
  const next: BaselineFile = { ...baseline };
  let ok = true;
  for (const [name, value] of Object.entries(metrics)) {
    const ref = baseline[name];
    const budget = budgets[name];
    if (budget !== undefined && value > budget) {
      ok = false;
      lines.push(`${name} : ${value} dépasse le budget ${budget}`);
      continue;
    }
    if (!ref) {
      next[name] = { value, at: now, ...(task ? { task } : {}) };
      lines.push(`${name} : première mesure ${value} (référence posée)`);
    } else if (value > ref.value * (1 + tolerancePct / 100)) {
      ok = false;
      lines.push(`${name} : ${ref.value} → ${value} (+${Math.round(((value - ref.value) / ref.value) * 100)} %, tolérance ${tolerancePct} %)`);
    } else {
      if (value < ref.value) next[name] = { value, at: now, ...(task ? { task } : {}) };
      lines.push(`${name} : ${ref.value} → ${value}${value < ref.value ? ' (mieux : nouvelle référence)' : ''}`);
    }
  }
  if (!Object.keys(metrics).length) lines.push('aucune mesure `clé=valeur` dans la sortie de la commande `performance`');
  return { ok, lines, next };
}

/** Applique la comparaison à la sortie de la commande `performance` ; ne met la référence à jour que si tout est vert. */
export function checkPerformance(store: BrainStore, stdout: string, task?: string): PerfResult {
  const cfg = store.config() as { perfTolerancePct?: number; perfBudgets?: Record<string, number> };
  const r = comparePerf(readBaseline(store), parseMetrics(stdout), cfg.perfTolerancePct ?? DEFAULT_TOLERANCE_PCT, cfg.perfBudgets ?? {}, task);
  if (r.ok) writeJsonAtomic(file(store), r.next);
  return r;
}

export function resetBaseline(store: BrainStore, metric?: string): void {
  const base = readBaseline(store);
  if (metric) delete base[metric];
  writeJsonAtomic(file(store), metric ? base : {});
}
