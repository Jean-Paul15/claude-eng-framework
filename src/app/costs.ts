import { readJson, writeJsonAtomic } from '../infra/fs.js';
import type { BrainStore } from '../brain/store.js';

/**
 * Registre des coûts de production : une ligne par service payant (unité facturée, prix, source datée, usage par utilisateur actif,
 * palier gratuit). `ceng cost --users N` estime la facture mensuelle. Les coûts font partie de la conception : une fonctionnalité qui
 * multiplie la facture par 10 au premier pic est un bug.
 */

export interface CostLine {
  name: string;
  unit: string;
  unitPriceUsd: number;
  /** URL et date de vérification du prix (un prix sans source est une supposition). */
  source: string;
  checkedAt: string;
  perActiveUserPerMonth: number;
  freeTier: number;
}

const file = (store: BrainStore) => `${store.paths.brain}/costs.json`;
export const readCosts = (store: BrainStore): CostLine[] => readJson<CostLine[]>(file(store)) ?? [];

export function addCost(store: BrainStore, line: Omit<CostLine, 'checkedAt'>): CostLine {
  if (!line.name.trim() || !line.source.trim()) throw new Error('Un service a un nom et une source de prix (URL).');
  if (![line.unitPriceUsd, line.perActiveUserPerMonth, line.freeTier].every((n) => Number.isFinite(n) && n >= 0)) throw new Error('Prix, usage par utilisateur et palier gratuit : nombres positifs.');
  const full: CostLine = { ...line, name: line.name.trim(), checkedAt: new Date().toISOString().slice(0, 10) };
  writeJsonAtomic(file(store), [...readCosts(store).filter((c) => c.name !== full.name), full]);
  return full;
}

export interface CostEstimate {
  users: number;
  lines: { name: string; usage: number; billable: number; usd: number }[];
  totalUsd: number;
}

export function estimateCosts(costs: readonly CostLine[], users: number): CostEstimate {
  const lines = costs.map((c) => {
    const usage = c.perActiveUserPerMonth * users;
    const billable = Math.max(0, usage - c.freeTier);
    return { name: c.name, usage, billable, usd: Math.round(billable * c.unitPriceUsd * 100) / 100 };
  });
  return { users, lines, totalUsd: Math.round(lines.reduce((s, l) => s + l.usd, 0) * 100) / 100 };
}

/** Domaines dont l'usage se facture : chacun exige que son service ait une ligne dans le registre avant de livrer. */
export const PAID_DOMAINS = ['ai-llm', 'payments', 'maps', 'sms', 'email', 'storage', 'realtime'] as const;
