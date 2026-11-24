import { readJson, writeJsonAtomic } from '../infra/fs.js';
import type { CustomRule } from '../domain/code-check.js';
import type { BrainStore } from '../brain/store.js';

/**
 * Règles de contrôle propres au projet (`.ceng/brain/rules.json`) : une erreur relevée en revue ne doit plus pouvoir être
 * réécrite. Appliquées par le contrôle immédiat du code, en avertissement, sans jeton tant que tout va bien.
 */

export interface StoredRule extends CustomRule {
  id: string;
  at: string;
}

export const MAX_RULES = 30;
const file = (store: BrainStore) => `${store.paths.brain}/rules.json`;

export const listRules = (store: BrainStore): StoredRule[] => readJson<StoredRule[]>(file(store)) ?? [];

export function addRule(store: BrainStore, input: { pattern: string; message: string; glob?: string }): StoredRule {
  try {
    new RegExp(input.pattern);
  } catch (err) {
    throw new Error(`Expression invalide : ${(err as Error).message}`);
  }
  if (!input.message.trim()) throw new Error('--message obligatoire : ce que la règle apprend à l\'agent.');
  const rules = listRules(store);
  if (rules.length >= MAX_RULES) throw new Error(`${MAX_RULES} règles au plus : retirer une règle devenue inutile (\`ceng rule remove <id>\`).`);
  const max = rules.reduce((m, r) => Math.max(m, Number(/R(\d+)/.exec(r.id)?.[1] ?? 0)), 0);
  const rule: StoredRule = { id: `R${String(max + 1).padStart(2, '0')}`, pattern: input.pattern, message: input.message.trim(), ...(input.glob ? { glob: input.glob } : {}), at: new Date().toISOString() };
  writeJsonAtomic(file(store), [...rules, rule]);
  return rule;
}

export function removeRule(store: BrainStore, id: string): void {
  const rules = listRules(store);
  if (!rules.some((r) => r.id === id.toUpperCase())) throw new Error(`Règle ${id} introuvable.`);
  writeJsonAtomic(file(store), rules.filter((r) => r.id !== id.toUpperCase()));
}
