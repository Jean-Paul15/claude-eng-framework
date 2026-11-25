import * as fs from 'node:fs';
import * as path from 'node:path';
import { redactDeep } from '../domain/secrets.js';
import { buildDashboardState, type DashboardState } from '../domain/dashboard-state.js';
import type { BrainStore } from '../brain/store.js';
import { exists, listFiles, readText } from '../infra/fs.js';
import { listFeatures } from './features.js';
import { inboxItems } from './inbox.js';

/** Lit le cerveau du projet et en tire l'état du tableau de bord (la page vivante et l'instantané partagent cette lecture). */

const IMAGE = /\.(png|jpe?g|webp)$/i;

/** Captures par tâche, chemins relatifs à `.ceng/shots/`. */
function listShots(store: BrainStore): Record<string, string[]> {
  const dir = path.join(store.paths.ceng, 'shots');
  const shots: Record<string, string[]> = {};
  if (!exists(dir)) return shots;
  for (const t of fs.readdirSync(dir)) {
    const sub = path.join(dir, t);
    if (!fs.statSync(sub).isDirectory()) continue;
    shots[t] = listFiles(sub, { maxFiles: 200 }).files.filter((f) => IMAGE.test(f)).map((f) => `${t}/${f}`);
  }
  return shots;
}

/** Incréments clôturés : un rapport par chantier dans `.ceng/brain/increments/`. */
function closedIncrements(store: BrainStore): string[] {
  const dir = path.join(store.paths.brain, 'increments');
  return exists(dir) ? store.listDir(dir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')) : [];
}

/** Exigences du cahier des charges (`EX-xxx`) rattachées à au moins une tâche. */
function specCoverage(store: BrainStore): { total: number; open: number } | undefined {
  const spec = readText(path.join(store.paths.brain, 'spec.md'));
  const ids = spec ? [...new Set([...spec.matchAll(/\bEX-\d{3,}\b/g)].map((x) => x[0]))] : [];
  if (!ids.length) return undefined;
  const covered = new Set(store.tasks().filter((t) => t.status !== 'cancelled').flatMap((t) => t.spec ?? []));
  return { total: ids.length, open: ids.filter((i) => !covered.has(i)).length };
}

export function loadDashboardState(store: BrainStore, now = new Date()): DashboardState {
  const coverage = specCoverage(store);
  const events = store.events();
  const last = events[events.length - 1]?.ts;
  return redactDeep(buildDashboardState({
    project: path.basename(store.paths.root),
    now,
    tasks: store.tasks(),
    events,
    closedIncrements: closedIncrements(store),
    activity: { ...(last ? { last } : {}), total: events.length },
    featureStatuses: listFeatures(store).map((f) => f.status),
    waiting: inboxItems(store).map((i) => ({ level: i.level, source: i.source, question: i.question })),
    ...(coverage ? { specCoverage: coverage } : {}),
    shots: listShots(store),
  }));
}
