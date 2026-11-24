import { readJson, writeJsonAtomic, writeTextAtomic } from '../infra/fs.js';
import type { BrainStore } from '../brain/store.js';
import type { Task } from '../domain/types.js';

/**
 * Registre des fonctionnalités : ce qui est décidé, en cours, livré, écarté ou remplacé. Source de vérité
 * `.ceng/brain/features.json`, vue lisible `FEATURES.md`. C'est la mémoire de « ce qu'on a déjà » : à chaque demande, on
 * regarde ici avant d'écrire quoi que ce soit (rappel automatique, garde anti-doublon, `ceng similar`).
 */

export type FeatureStatus = 'decided' | 'in_progress' | 'delivered' | 'rejected' | 'replaced';

export interface Feature {
  id: string;
  name: string;
  summary: string;
  status: FeatureStatus;
  /** Obligatoire pour `rejected` et `replaced` : c'est ce qui empêche de reproposer une idée déjà écartée. */
  reason?: string;
  replacedBy?: string;
  surfaces: string[];
  spec: string[];
  decisions: string[];
  tasks: string[];
  files: string[];
  keywords: string[];
  updatedAt: string;
}

export const FEATURE_STATUSES: readonly FeatureStatus[] = ['decided', 'in_progress', 'delivered', 'rejected', 'replaced'];
const LABEL: Record<FeatureStatus, string> = { decided: 'DÉCIDÉE', in_progress: 'EN COURS', delivered: 'LIVRÉE', rejected: 'ÉCARTÉE', replaced: 'REMPLACÉE' };
export const featureLabel = (s: FeatureStatus): string => LABEL[s];

const file = (store: BrainStore) => `${store.paths.brain}/features.json`;
const now = () => new Date().toISOString();

export const listFeatures = (store: BrainStore): Feature[] => readJson<Feature[]>(file(store)) ?? [];

function save(store: BrainStore, features: Feature[]): void {
  writeJsonAtomic(file(store), features);
  writeTextAtomic(`${store.paths.brain}/FEATURES.md`, renderFeatures(features));
}

export function renderFeatures(features: readonly Feature[]): string {
  const out = ['# Fonctionnalités', '<!-- Généré par ceng (`ceng feature …`) : ne pas éditer à la main. -->', ''];
  for (const status of FEATURE_STATUSES) {
    const group = features.filter((f) => f.status === status);
    if (!group.length) continue;
    out.push(`## ${LABEL[status]} (${group.length})`);
    for (const f of group) out.push(`- **${f.id}** ${f.name} — ${f.summary}${f.reason ? ` _(${f.reason})_` : ''}${f.tasks.length ? ` · ${f.tasks.join(', ')}` : ''}`);
    out.push('');
  }
  return `${out.join('\n')}\n`;
}

function nextFeatureId(features: readonly Feature[]): string {
  const max = features.reduce((m, f) => Math.max(m, Number(/F-(\d+)/.exec(f.id)?.[1] ?? 0)), 0);
  return `F-${String(max + 1).padStart(3, '0')}`;
}

export interface NewFeature {
  name: string;
  summary: string;
  surfaces?: string[];
  spec?: string[];
  keywords?: string[];
  status?: FeatureStatus;
}

export function addFeature(store: BrainStore, input: NewFeature): Feature {
  if (!input.name.trim() || !input.summary.trim()) throw new Error('Une fonctionnalité a un nom et une phrase de résumé.');
  const features = listFeatures(store);
  const f: Feature = {
    id: nextFeatureId(features), name: input.name.trim(), summary: input.summary.trim(), status: input.status ?? 'decided',
    surfaces: input.surfaces ?? [], spec: input.spec ?? [], decisions: [], tasks: [], files: [], keywords: input.keywords ?? [], updatedAt: now(),
  };
  save(store, [...features, f]);
  return f;
}

export function getFeature(store: BrainStore, id: string): Feature {
  const f = listFeatures(store).find((x) => x.id === id.toUpperCase());
  if (!f) throw new Error(`Fonctionnalité ${id} introuvable (\`ceng feature list\`).`);
  return f;
}

function update(store: BrainStore, id: string, fn: (f: Feature) => void): Feature {
  const features = listFeatures(store);
  const f = features.find((x) => x.id === id.toUpperCase());
  if (!f) throw new Error(`Fonctionnalité ${id} introuvable (\`ceng feature list\`).`);
  fn(f);
  f.updatedAt = now();
  save(store, features);
  return f;
}

/** Écarte une fonctionnalité : la raison est obligatoire (elle sert à ne pas reproposer l'idée). */
export function rejectFeature(store: BrainStore, id: string, reason: string): Feature {
  if (!reason.trim()) throw new Error('--reason obligatoire : pourquoi cette fonctionnalité est écartée.');
  return update(store, id, (f) => {
    f.status = 'rejected';
    f.reason = reason.trim();
  });
}

export function replaceFeature(store: BrainStore, id: string, by: string, reason: string): Feature {
  if (!reason.trim()) throw new Error('--reason obligatoire : pourquoi elle est remplacée.');
  getFeature(store, by);
  return update(store, id, (f) => {
    f.status = 'replaced';
    f.replacedBy = by.toUpperCase();
    f.reason = reason.trim();
  });
}

/** Tâche rattachée : la fonctionnalité passe en cours dès que la tâche démarre. */
export function linkTask(store: BrainStore, featureId: string, taskId: string): void {
  update(store, featureId, (f) => {
    if (!f.tasks.includes(taskId)) f.tasks.push(taskId);
    if (f.status === 'decided') f.status = 'in_progress';
  });
}

/** Toutes les tâches rattachées sont terminées : la fonctionnalité est livrée et garde les fichiers qui la portent. */
export function onTaskDone(store: BrainStore, task: Pick<Task, 'id' | 'feature'>): void {
  if (!task.feature) return;
  const tasks = store.tasks();
  update(store, task.feature, (f) => {
    const mine = tasks.filter((t) => f.tasks.includes(t.id));
    f.files = [...new Set(mine.filter((t) => t.status === 'done').flatMap((t) => t.files))];
    if (mine.length && mine.every((t) => t.status === 'done' || t.status === 'cancelled')) f.status = 'delivered';
  });
}

/** Projet existant sans registre : une fonctionnalité par groupe de tâches (champ `group`), à corriger ensuite par l'orchestrateur. */
export function importFeatures(store: BrainStore): Feature[] {
  const features = listFeatures(store);
  const taken = new Set(features.flatMap((f) => f.tasks));
  const groups = new Map<string, Task[]>();
  for (const t of store.tasks().filter((x) => x.group && !taken.has(x.id) && x.status !== 'cancelled')) {
    groups.set(t.group!, [...(groups.get(t.group!) ?? []), t]);
  }
  const added: Feature[] = [];
  for (const [group, tasks] of groups) {
    const done = tasks.every((t) => t.status === 'done');
    const f: Feature = {
      id: nextFeatureId([...features, ...added]), name: group, summary: tasks.map((t) => t.title).slice(0, 3).join(' ; '),
      status: done ? 'delivered' : tasks.some((t) => t.status === 'in_progress') ? 'in_progress' : 'decided',
      surfaces: [], spec: [], decisions: [], tasks: tasks.map((t) => t.id), files: done ? [...new Set(tasks.flatMap((t) => t.files))] : [], keywords: [], updatedAt: now(),
    };
    added.push(f);
    for (const t of tasks) store.updateTasks((all) => {
      const x = all.find((y) => y.id === t.id);
      if (x) x.feature = f.id;
    });
  }
  if (added.length) save(store, [...features, ...added]);
  return added;
}
