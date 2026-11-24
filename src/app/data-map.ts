import * as path from 'node:path';
import { classificationProblems, parseComments, parseTables, renderDataMap } from '../domain/data-map.js';
import { listFiles, readText, writeTextAtomic } from '../infra/fs.js';
import type { GateStatus } from '../domain/types.js';
import type { BrainStore } from '../brain/store.js';

/** Fichiers SQL de migration du projet (`migrations/`), pour la carte des données et la gate `privacy`. */
const isMigration = (f: string): boolean => /\.sql$/i.test(f) && /(^|\/)migrations?\//i.test(f);

export const migrationFiles = (root: string): string[] => listFiles(root, { maxFiles: 20000 }).files.filter(isMigration);

const sqlOf = (root: string, files: readonly string[]): string => files.map((f) => readText(path.join(root, f)) ?? '').join('\n');

/** Problèmes de classification des tables créées ou modifiées par `changed` (toutes les migrations si `changed` est omis). */
export function dataMapProblems(root: string, changed?: readonly string[]): string[] {
  const all = migrationFiles(root);
  const scope = changed ? all.filter((f) => changed.includes(f)) : all;
  if (!scope.length) return [];
  return classificationProblems(parseTables(sqlOf(root, scope)), parseComments(sqlOf(root, all)));
}

export function runPrivacyGate(root: string, changed: readonly string[]): { status: GateStatus; detail: string } {
  const touched = changed.filter(isMigration);
  if (!touched.length) return { status: 'pass', detail: 'Aucune migration modifiée par la tâche.' };
  const problems = dataMapProblems(root, touched);
  return problems.length
    ? { status: 'fail', detail: `Colonnes de tables personnelles non classées :\n${problems.slice(0, 12).map((p) => `- ${p}`).join('\n')}` }
    : { status: 'pass', detail: 'Toutes les colonnes personnelles ajoutées sont classées (carte : `ceng data-map`).' };
}

export function writeDataMap(store: BrainStore): { file: string; entries: number } {
  const root = store.paths.root;
  const comments = parseComments(sqlOf(root, migrationFiles(root)));
  const file = path.join(store.paths.brain, 'data-map.md');
  writeTextAtomic(file, renderDataMap(comments));
  return { file: store.paths.rel(file), entries: comments.filter((c) => c.pii !== 'none').length };
}
