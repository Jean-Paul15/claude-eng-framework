import type { Task } from './types.js';

/** Opérations pures sur le graphe de tâches. */

export function indexById(tasks: readonly Task[]): Map<string, Task> {
  return new Map(tasks.map((t) => [t.id, t]));
}

/** Tâches prêtes : en attente, toutes dépendances terminées. */
export function readyTasks(tasks: readonly Task[]): Task[] {
  const byId = indexById(tasks);
  return tasks.filter(
    (t) => t.status === 'pending' && t.deps.every((d) => byId.get(d)?.status === 'done'),
  );
}

/** Nombre de tâches qui dépendent (transitivement) de chaque tâche : sert à prioriser le chemin critique. */
export function dependentCounts(tasks: readonly Task[]): Map<string, number> {
  const children = new Map<string, string[]>();
  for (const t of tasks) for (const d of t.deps) children.set(d, [...(children.get(d) ?? []), t.id]);
  const memo = new Map<string, Set<string>>();
  const visit = (id: string, stack: Set<string>): Set<string> => {
    const cached = memo.get(id);
    if (cached) return cached;
    const acc = new Set<string>();
    if (stack.has(id)) return acc; // cycle : signalé par findCycle, ignoré ici
    stack.add(id);
    for (const c of children.get(id) ?? []) {
      acc.add(c);
      for (const x of visit(c, stack)) acc.add(x);
    }
    stack.delete(id);
    memo.set(id, acc);
    return acc;
  };
  return new Map(tasks.map((t) => [t.id, visit(t.id, new Set()).size]));
}

/** Renvoie un cycle de dépendances s'il en existe un (liste d'IDs), sinon null. */
export function findCycle(tasks: readonly Task[]): string[] | null {
  const byId = indexById(tasks);
  const state = new Map<string, 'visiting' | 'done'>();
  const path: string[] = [];
  const dfs = (id: string): string[] | null => {
    if (state.get(id) === 'done') return null;
    if (state.get(id) === 'visiting') return [...path.slice(path.indexOf(id)), id];
    state.set(id, 'visiting');
    path.push(id);
    for (const d of byId.get(id)?.deps ?? []) {
      const cycle = dfs(d);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(id, 'done');
    return null;
  };
  for (const t of tasks) {
    const c = dfs(t.id);
    if (c) return c;
  }
  return null;
}

export function missingDeps(tasks: readonly Task[]): { task: string; dep: string }[] {
  const ids = new Set(tasks.map((t) => t.id));
  return tasks.flatMap((t) => t.deps.filter((d) => !ids.has(d)).map((dep) => ({ task: t.id, dep })));
}

export function nextId(prefix: string, existing: readonly string[]): string {
  const max = existing
    .map((id) => Number.parseInt(id.replace(`${prefix}-`, ''), 10))
    .filter((n) => Number.isFinite(n))
    .reduce((m, n) => Math.max(m, n), 0);
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}
