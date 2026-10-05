import type { BrainStore } from '../brain/store.js';
import type { Commands } from '../discovery/profile.js';

/**
 * Commandes de gates recommandées pour le projet (déduites de sa vraie pile) face à celles de `.ceng/config.json`.
 * Le diff est pur (testable) ; l'écriture ne touche que la clé `commands` de la configuration.
 */

export type CommandChange = 'unchanged' | 'added' | 'changed' | 'kept';

export interface CommandRow {
  gate: keyof Commands;
  change: CommandChange;
  /** Commande recommandée (absente pour `kept` : le projet l'a définie, la détection n'en propose pas). */
  recommended?: string;
  current?: string;
}

const GATE_ORDER: (keyof Commands)[] = ['install', 'build', 'typecheck', 'lint', 'format', 'unit', 'integration', 'e2e', 'contract', 'deps-audit', 'migration', 'performance', 'dev'];

export function diffCommands(current: Commands, recommended: Commands): CommandRow[] {
  const rows: CommandRow[] = [];
  for (const gate of GATE_ORDER) {
    const cur = current[gate];
    const rec = recommended[gate];
    if (!cur && !rec) continue;
    if (rec && !cur) rows.push({ gate, change: 'added', recommended: rec });
    else if (rec && cur === rec) rows.push({ gate, change: 'unchanged', recommended: rec, current: cur! });
    else if (rec) rows.push({ gate, change: 'changed', recommended: rec, current: cur! });
    else rows.push({ gate, change: 'kept', current: cur! });
  }
  return rows;
}

/** Les commandes à écrire : les recommandées remplacent les actuelles ; celles que la détection ne propose pas sont conservées. */
export function mergedCommands(current: Commands, recommended: Commands): Commands {
  return { ...current, ...recommended };
}

export const hasChanges = (rows: readonly CommandRow[]): boolean => rows.some((r) => r.change === 'added' || r.change === 'changed');

/** Écrit les commandes recommandées dans la configuration (fichier de garde-fous : à n'appeler qu'après validation humaine). */
export function applyCommands(store: BrainStore, recommended: Commands): Commands {
  const config = store.config();
  const commands = mergedCommands(config.commands, recommended);
  store.saveConfig({ ...config, commands });
  return commands;
}
