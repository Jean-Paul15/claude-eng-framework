import * as path from 'node:path';
import { classificationProblems, parseComments, parseTables, renderDataMap } from '../domain/data-map.js';
import { exists, listFiles, readText, writeTextAtomic } from '../infra/fs.js';
import { runShell, tail } from '../infra/exec.js';
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

/**
 * Projet Supabase : chaque table créée par la tâche est citée dans au moins un test (`supabase/tests/*.sql`, pgTAP) — la politique
 * d'accès d'une table jamais testée est la faille la plus grave et la plus invisible d'un produit Supabase. Si le projet définit
 * `commands['db-lint']` ou `commands['db-test']` (supabase db lint, supabase test db ; Docker requis), elles sont exécutées.
 */
export function runDbSecurityGate(store: BrainStore, changed: readonly string[]): { status: GateStatus; detail: string } {
  const root = store.paths.root;
  if (!exists(path.join(root, 'supabase', 'config.toml'))) return { status: 'pass', detail: 'Projet sans Supabase : sans objet.' };
  const touched = changed.filter(isMigration);
  if (!touched.length) return { status: 'pass', detail: 'Aucune migration modifiée par la tâche.' };
  const created = [...new Set(parseTables(sqlOf(root, touched)).filter((t) => !t.alter).map((t) => t.name))];
  const tests = listFiles(root, { maxFiles: 20000 }).files.filter((f) => /(^|\/)supabase\/tests\/.*\.sql$/i.test(f));
  const testText = sqlOf(root, tests).toLowerCase();
  const untested = created.filter((t) => !new RegExp(`\\b${t}\\b`).test(testText));
  if (untested.length) {
    return { status: 'fail', detail: `Tables sans test d'accès : ${untested.join(', ')} → écrire supabase/tests/<table>.sql (pgTAP : l'utilisateur A ne lit ni ne modifie les lignes de B ; l'anonyme n'accède à rien).` };
  }
  const commands = store.config().commands as Record<string, string | undefined>;
  for (const key of ['db-lint', 'db-test']) {
    const cmd = commands[key];
    if (!cmd) continue;
    const r = runShell(cmd, { cwd: root, timeoutMs: 10 * 60_000 });
    if (r.code !== 0) return { status: 'fail', detail: `${cmd} → exit ${r.code}\n${tail(`${r.stdout}\n${r.stderr}`.trim(), 15)}` };
  }
  return { status: 'pass', detail: `${created.length} table(s) créée(s), toutes testées.` };
}

export function writeDataMap(store: BrainStore): { file: string; entries: number } {
  const root = store.paths.root;
  const comments = parseComments(sqlOf(root, migrationFiles(root)));
  const file = path.join(store.paths.brain, 'data-map.md');
  writeTextAtomic(file, renderDataMap(comments));
  return { file: store.paths.rel(file), entries: comments.filter((c) => c.pii !== 'none').length };
}
