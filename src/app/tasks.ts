import { routeTask } from '../domain/routing.js';
import { findCycle, missingDeps, nextId } from '../domain/taskgraph.js';
import { TASK_KINDS, type Assessment, type Level, type ModelTier, type Task, type TaskKind } from '../domain/types.js';
import { exists } from '../infra/fs.js';
import type { BrainStore } from '../brain/store.js';

/** Cas d'usage autour des tâches : création, routage, transitions d'état. */

export interface NewTaskInput {
  title: string;
  kind: TaskKind;
  assessment?: Partial<Assessment>;
  files?: string[];
  deps?: string[];
  acceptance?: string[];
  domains?: string[];
  interfaces?: string[];
  group?: string;
}

const now = () => new Date().toISOString();

export function parseLevel(value: string | undefined, name: string, fallback: Level): Level {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error(`--${name} doit être un entier entre 1 et 5 (reçu « ${value} »).`);
  return n as Level;
}

export function parseKind(value: string | undefined): TaskKind {
  const k = (value ?? 'feature') as TaskKind;
  if (!TASK_KINDS.includes(k)) throw new Error(`--kind invalide « ${value} » (valeurs : ${TASK_KINDS.join(', ')}).`);
  return k;
}

export function csv(value: string | undefined): string[] {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function createTask(store: BrainStore, input: NewTaskInput): Task {
  if (!input.title.trim()) throw new Error('Une tâche doit avoir un titre.');
  const task = store.updateTasks((tasks) => {
    const t: Task = {
      id: nextId('T', tasks.map((x) => x.id)),
      title: input.title.trim(),
      kind: input.kind,
      status: 'pending',
      assessment: {
        complexity: 2, risk: 2, ambiguity: 2, novelty: 1, architecturalImpact: 1, contextSize: 'M',
        ...input.assessment,
      } as Assessment,
      files: input.files ?? [],
      deps: (input.deps ?? []).map((d) => d.toUpperCase()),
      acceptance: input.acceptance ?? [],
      domains: input.domains ?? [],
      interfaces: input.interfaces ?? [],
      ...(input.group ? { group: input.group } : {}),
      attempts: [],
      gates: [],
      createdAt: now(),
      updatedAt: now(),
    };
    const candidate = [...tasks, t];
    const missing = missingDeps(candidate).filter((m) => m.task === t.id);
    if (missing.length) throw new Error(`Dépendances inconnues : ${missing.map((m) => m.dep).join(', ')}.`);
    const cycle = findCycle(candidate);
    if (cycle) throw new Error(`Cycle de dépendances : ${cycle.join(' → ')}.`);
    if (t.assessment.complexity >= 3 && t.acceptance.length === 0 && !['research', 'design'].includes(t.kind)) {
      throw new Error('Tâche non triviale sans critère d\'acceptation : ajouter --accept "…" (une tâche ne peut être déclarée terminée sans critère vérifiable).');
    }
    tasks.push(t);
    return t;
  });
  store.log({ type: 'task.created', taskId: task.id, data: { kind: task.kind, assessment: task.assessment, domains: task.domains } });
  return task;
}

export function routeAndStore(store: BrainStore, id: string): Task {
  const config = store.config();
  const hasCreativeDirection = exists(`${store.paths.root}/docs/CREATIVE_DIRECTION.md`);
  const overrides = store.overrides();
  const task = store.updateTasks((tasks) => {
    const t = tasks.find((x) => x.id === id.toUpperCase());
    if (!t) throw new Error(`Tâche ${id} introuvable.`);
    t.route = routeTask(t, { policy: config.policy, ...(overrides ? { overrides } : {}), hasCreativeDirection });
    t.updatedAt = now();
    return t;
  });
  const r = task.route!;
  store.log({
    type: 'route.decided',
    taskId: task.id,
    model: r.implementer.model,
    data: { executor: r.executor, agent: r.implementer.agent, effort: r.implementer.effort, review: r.reviewLevel, gates: r.gates.map((g) => g.gate), escalate: r.escalate.required, costIndex: r.costIndex, reasons: r.reasons },
  });
  return task;
}

export function startTask(store: BrainStore, id: string, agent?: string, model?: ModelTier, strategy?: string): Task {
  let task = store.task(id);
  if (task.status === 'done' || task.status === 'cancelled') throw new Error(`${task.id} est déjà ${task.status}.`);
  const unmet = task.deps.filter((d) => store.tasks().find((t) => t.id === d)?.status !== 'done');
  if (unmet.length) throw new Error(`${task.id} dépend de tâches non terminées : ${unmet.join(', ')}.`);
  if (!task.route) task = routeAndStore(store, task.id);
  const route = task.route!;
  task = store.updateTasks((tasks) => {
    const t = tasks.find((x) => x.id === task.id)!;
    t.status = 'in_progress';
    t.attempts.push({
      n: t.attempts.length + 1,
      agent: agent ?? (route.executor === 'direct' ? 'orchestrator' : route.implementer.agent),
      model: model ?? route.implementer.model,
      ...(strategy ? { strategy } : {}),
      startedAt: now(),
      outcome: 'running',
    });
    t.updatedAt = now();
    return t;
  });
  store.updateState((s) => {
    s.currentTask = task.id;
  });
  const attempt = task.attempts.at(-1)!;
  store.log({ type: 'task.started', taskId: task.id, model: attempt.model, data: { attempt: attempt.n, agent: attempt.agent, strategy } });
  return task;
}

/** Clôt la tentative en cours ; renvoie false s'il n'y en avait pas. */
function closeAttempt(t: Task, outcome: 'success' | 'failure' | 'abandoned', reason?: string): boolean {
  const a = [...t.attempts].reverse().find((x) => x.outcome === 'running');
  if (!a) return false;
  a.outcome = outcome;
  a.endedAt = now();
  if (reason) a.reason = reason;
  return true;
}

export interface CompletionCheck {
  ok: boolean;
  missing: string[];
}

/** Une tâche n'est terminée que si ses gates requises sont passées (ou dérogées explicitement). */
export function completionCheck(store: BrainStore, task: Task): CompletionCheck {
  const missing: string[] = [];
  for (const req of task.route?.gates ?? []) {
    if (!req.required) continue;
    const result = task.gates.find((g) => g.gate === req.gate);
    if (req.gate === 'report') {
      if (!exists(store.paths.report(task.id))) missing.push(`report (rapport .ceng/brain/reports/${task.id}.md absent)`);
      continue;
    }
    if (!result || !['pass', 'skipped', 'waived'].includes(result.status)) missing.push(`${req.gate} (${result?.status ?? 'non exécutée'})`);
  }
  return { ok: missing.length === 0, missing };
}

export function completeTask(store: BrainStore, id: string, evidence: string, waiver?: string): Task {
  // Une tâche jamais routée n'a pas de gates : on la route d'abord, sinon « done » ne prouverait rien.
  const before = store.task(id).route ? store.task(id) : routeAndStore(store, id);
  const check = completionCheck(store, before);
  if (!check.ok && !waiver) {
    throw new Error(
      `${before.id} ne peut pas être terminée : gates requises manquantes → ${check.missing.join(', ')}.\n` +
        `Lancer \`ceng gate run ${before.id}\` (ou \`ceng gate record ${before.id} <gate> pass --note …\` pour une gate de revue), ` +
        'ou déroger explicitement avec --waive "raison" (dérogation journalisée et visible dans le rapport).',
    );
  }
  const task = store.updateTasks((tasks) => {
    const t = tasks.find((x) => x.id === before.id)!;
    t.status = 'done';
    t.evidence = evidence;
    if (waiver) t.waiver = `${waiver} (gates : ${check.missing.join(', ')})`;
    closeAttempt(t, 'success');
    t.updatedAt = now();
    return t;
  });
  store.updateState((s) => {
    if (s.currentTask === task.id) delete s.currentTask;
    delete s.interruption;
  });
  store.log({ type: 'task.done', taskId: task.id, model: task.attempts.at(-1)?.model, data: { evidence, waiver, attempts: task.attempts.length, gates: task.gates.map((g) => `${g.gate}:${g.status}`) } });
  return task;
}

export function failAttempt(store: BrainStore, id: string, reason: string): Task {
  const task = store.updateTasks((tasks) => {
    const t = tasks.find((x) => x.id === id.toUpperCase());
    if (!t) throw new Error(`Tâche ${id} introuvable.`);
    if (!closeAttempt(t, 'failure', reason)) {
      t.attempts.push({ n: t.attempts.length + 1, agent: 'unknown', model: 'sonnet', startedAt: now(), endedAt: now(), outcome: 'failure', reason });
    }
    t.status = 'pending';
    t.updatedAt = now();
    return t;
  });
  // Re-router : la politique d'escalade dépend du nombre d'échecs.
  const rerouted = routeAndStore(store, task.id);
  store.log({ type: 'task.failed', taskId: task.id, data: { reason, failures: task.attempts.filter((a) => a.outcome === 'failure').length, escalate: rerouted.route?.escalate } });
  return rerouted;
}

export function blockTask(store: BrainStore, id: string, reason: string): Task {
  const task = store.updateTasks((tasks) => {
    const t = tasks.find((x) => x.id === id.toUpperCase());
    if (!t) throw new Error(`Tâche ${id} introuvable.`);
    t.status = 'blocked';
    t.blockedReason = reason;
    closeAttempt(t, 'abandoned', reason);
    t.updatedAt = now();
    return t;
  });
  store.updateState((s) => {
    if (s.currentTask === task.id) delete s.currentTask;
  });
  store.log({ type: 'task.blocked', taskId: task.id, data: { reason } });
  return task;
}

export function setStatus(store: BrainStore, id: string, status: Task['status'], reason?: string): Task {
  const task = store.updateTasks((tasks) => {
    const t = tasks.find((x) => x.id === id.toUpperCase());
    if (!t) throw new Error(`Tâche ${id} introuvable.`);
    t.status = status;
    if (status === 'pending') delete t.blockedReason;
    t.updatedAt = now();
    return t;
  });
  store.log({ type: 'task.status', taskId: task.id, data: { status, reason } });
  return task;
}
