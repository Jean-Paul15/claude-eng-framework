import type { AgentRow, AgentStat, Backlog, BacklogItem, Board, BoardCard, CfdPoint, DayPoint, Funnel, GanttBar, GroupSeries, Metrics, Slowdowns, UsageSummary } from './dashboard-types.js';
import type { FrameworkEvent } from './events.js';
import { gateTallies, groupKey } from './report-stats.js';
import { dependentCounts, indexById } from './taskgraph.js';
import type { Task, TaskStatus } from './types.js';

/**
 * Calculs de gestion de projet agile du tableau de bord : tableau scrum, Gantt, débit et date de fin prévue, entonnoir, backlog,
 * diagramme de flux cumulé, tâches à l'arrêt, agents et jetons. Fonctions pures : le « maintenant » est toujours passé en argument.
 */

const DAY = 86_400_000;
const live = (tasks: readonly Task[]): Task[] => tasks.filter((t) => t.status !== 'cancelled');
const lastAttempt = (t: Task) => t.attempts[t.attempts.length - 1];
const ms = (iso: string | undefined): number => (iso ? Date.parse(iso) : NaN);
const dayKey = (t: number): string => new Date(t).toISOString().slice(0, 10);
const sum = (a: readonly number[]): number => a.reduce((x, y) => x + y, 0);

/** Début de travail d'une tâche : premier essai, sinon sa création. */
const startOf = (t: Task): string => t.attempts[0]?.startedAt ?? t.createdAt;

/** Fin de travail : dernier essai terminé pour une tâche close, maintenant pour une tâche en cours ou en attente. */
function endOf(t: Task, now: Date): string {
  const end = t.status === 'in_progress' || t.status === 'pending' ? now.toISOString() : (lastAttempt(t)?.endedAt ?? t.updatedAt);
  return ms(end) >= ms(startOf(t)) ? end : startOf(t);
}

export function ganttBars(tasks: readonly Task[], now: Date, by: 'chantier' | 'type'): GanttBar[] {
  const ids = new Set(live(tasks).map((t) => t.id));
  return live(tasks).map((t) => ({ id: t.id, title: t.title, status: t.status, group: groupKey(t, by), start: startOf(t), end: endOf(t, now), deps: t.deps.filter((d) => ids.has(d)) }))
    .sort((a, b) => ms(a.start) - ms(b.start) || a.id.localeCompare(b.id));
}

const card = (t: Task): BoardCard => {
  const a = lastAttempt(t);
  const reason = t.blockedReason ?? (t.status === 'failed' ? a?.reason : undefined);
  return { id: t.id, title: t.title, kind: t.kind, status: t.status, ...(a?.model ? { model: a.model } : {}), ...(reason ? { reason } : {}), attempts: t.attempts.length, updatedAt: t.updatedAt };
};

const BOARD_LIMIT = { pending: 30, blocked: 30, done: 15 };

/** Tableau scrum : à faire (les plus anciennes d'abord), en cours, bloquées ou en échec, terminées (les plus récentes). */
export function boardOf(tasks: readonly Task[]): Board {
  const by = (status: TaskStatus[]) => live(tasks).filter((t) => status.includes(t.status));
  const pending = by(['pending']).sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  const blocked = by(['blocked', 'failed']).sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt));
  const done = by(['done']).sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt));
  return {
    pending: pending.slice(0, BOARD_LIMIT.pending).map(card),
    in_progress: by(['in_progress']).sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt)).map(card),
    blocked: blocked.slice(0, BOARD_LIMIT.blocked).map(card),
    done: done.slice(0, BOARD_LIMIT.done).map(card),
    hidden: { pending: Math.max(0, pending.length - BOARD_LIMIT.pending), blocked: Math.max(0, blocked.length - BOARD_LIMIT.blocked), done: Math.max(0, done.length - BOARD_LIMIT.done) },
  };
}

const median = (a: number[]): number | undefined => {
  if (!a.length) return undefined;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const FORECAST_MAX_DAYS = 730;

/** Débit, durée médiane, en cours, et date de fin si le rythme des 28 derniers jours se maintient. */
export function metricsOf(tasks: readonly Task[], daily: readonly DayPoint[], now: Date): Metrics {
  const l = live(tasks);
  const open = l.filter((t) => t.status !== 'done').length;
  const done28 = sum(daily.slice(-28).map((d) => d.done));
  const cycles = l.filter((t) => t.status === 'done' && t.attempts.length).map((t) => ms(endOf(t, now)) - ms(startOf(t))).filter((x) => Number.isFinite(x) && x >= 0);
  const cycle = median(cycles);
  const perDay = done28 / 28;
  const days = perDay > 0 && open > 0 ? Math.ceil(open / perDay) : undefined;
  return {
    doneLast7: sum(daily.slice(-7).map((d) => d.done)),
    donePrev7: sum(daily.slice(-14, -7).map((d) => d.done)),
    createdLast7: sum(daily.slice(-7).map((d) => d.created)),
    perWeek: Math.round((done28 / 4) * 10) / 10,
    ...(cycle !== undefined ? { cycleMedianHours: Math.round((cycle / 3_600_000) * 10) / 10 } : {}),
    open,
    wip: l.filter((t) => t.status === 'in_progress').length,
    blocked: l.filter((t) => t.status === 'blocked' || t.status === 'failed').length,
    ...(days !== undefined && days <= FORECAST_MAX_DAYS ? { forecast: { days, date: dayKey(now.getTime() + days * DAY) } } : {}),
  };
}

export function funnelOf(tasks: readonly Task[]): Funnel {
  const l = live(tasks);
  const done = l.filter((t) => t.status === 'done');
  return {
    created: l.length,
    started: l.filter((t) => t.attempts.length > 0 || t.status !== 'pending').length,
    done: done.length,
    clean: done.filter((t) => !t.waiver && !t.gates.some((g) => g.status === 'fail' || g.status === 'waived')).length,
  };
}

/** Backlog : maintenant (en cours), ensuite (prêtes, les plus utiles aux autres d'abord), plus tard (attendent une tâche), humain. */
export function backlogOf(tasks: readonly Task[], by: 'chantier' | 'type'): Backlog {
  const l = live(tasks);
  const byId = indexById(l);
  const unlocks = dependentCounts(l);
  const item = (t: Task): BacklogItem => {
    const waitingFor = t.deps.filter((d) => byId.has(d) && byId.get(d)!.status !== 'done');
    return { id: t.id, title: t.title, kind: t.kind, group: groupKey(t, by), waitingFor, unlocks: unlocks.get(t.id) ?? 0, ...(t.blockedReason ? { reason: t.blockedReason } : {}) };
  };
  const pending = l.filter((t) => t.status === 'pending').map(item);
  const bySize = (a: BacklogItem, b: BacklogItem) => b.unlocks - a.unlocks || a.id.localeCompare(b.id);
  return {
    now: l.filter((t) => t.status === 'in_progress').map(item),
    next: pending.filter((i) => !i.waitingFor.length).sort(bySize),
    later: pending.filter((i) => i.waitingFor.length).sort(bySize),
    human: l.filter((t) => t.status === 'blocked' || t.status === 'failed').map(item),
  };
}

const EVENT_STATUS: Partial<Record<string, TaskStatus>> = { 'task.created': 'pending', 'task.started': 'in_progress', 'task.done': 'done', 'task.failed': 'failed', 'task.blocked': 'blocked' };
const STATUSES: readonly TaskStatus[] = ['pending', 'in_progress', 'blocked', 'failed', 'done', 'cancelled'];

/** Diagramme de flux cumulé : état de chaque tâche à la fin de chaque jour, reconstitué depuis le journal d'événements. */
export function cfdOf(tasks: readonly Task[], events: readonly FrameworkEvent[], now: Date, days = 60): CfdPoint[] {
  const l = live(tasks);
  const known = new Set(l.map((t) => t.id));
  const transitions = new Map<string, { t: number; status: TaskStatus }[]>();
  for (const e of events) {
    if (!e.taskId || !known.has(e.taskId)) continue;
    const fromData = e.type === 'task.status' && typeof e.data?.['status'] === 'string' && STATUSES.includes(e.data['status'] as TaskStatus) ? (e.data['status'] as TaskStatus) : undefined;
    const status = fromData ?? EVENT_STATUS[e.type];
    if (!status) continue;
    const list = transitions.get(e.taskId) ?? [];
    list.push({ t: Date.parse(e.ts), status });
    transitions.set(e.taskId, list);
  }
  const today = Date.parse(dayKey(now.getTime()));
  return Array.from({ length: days }, (_, i) => {
    const day = today - (days - 1 - i) * DAY;
    const end = day + DAY - 1;
    const point: CfdPoint = { day: dayKey(day), pending: 0, in_progress: 0, blocked: 0, failed: 0, done: 0 };
    for (const t of l) {
      if (ms(t.createdAt) > end) continue;
      const seen = (transitions.get(t.id) ?? []).filter((x) => x.t <= end);
      const status: TaskStatus = seen.length ? seen[seen.length - 1]!.status : (transitions.has(t.id) ? 'pending' : t.status);
      if (status !== 'cancelled') point[status] += 1;
    }
    return point;
  });
}

const STUCK_LIMIT = 6;
const STALE_MS = 6 * 3_600_000;

/** Tâches à l'arrêt depuis le plus longtemps (bloquées, en échec, ou « en cours » sans nouvelle tentative) et contrôles qui échouent. */
export function slowdownsOf(tasks: readonly Task[], now: Date): Slowdowns {
  const stuck = live(tasks).flatMap((t) => {
    const since = t.status === 'in_progress' ? ms(lastAttempt(t)?.startedAt ?? t.updatedAt) : ms(t.updatedAt);
    const idle = now.getTime() - since;
    const stale = t.status === 'blocked' || t.status === 'failed' || (t.status === 'in_progress' && idle > STALE_MS);
    const reason = card(t).reason;
    return stale && Number.isFinite(idle) ? [{ id: t.id, title: t.title, status: t.status, days: Math.max(0, Math.round(idle / DAY)), ...(reason ? { reason } : {}) }] : [];
  }).sort((a, b) => b.days - a.days).slice(0, STUCK_LIMIT);
  const gates = gateTallies(tasks).map((g) => ({ gate: g.gate, fail: g.fail, total: g.pass + g.fail + g.waived + g.other })).filter((g) => g.fail > 0).sort((a, b) => b.fail - a.fail).slice(0, 4);
  return { stuck, gates };
}

const tokensOf = (e: FrameworkEvent): number => {
  const u = e.data?.['usage'] as { input?: number; output?: number } | undefined;
  return (u?.input ?? 0) + (u?.output ?? 0);
};
const family = (model: string | undefined): 'opus' | 'sonnet' | 'haiku' | 'other' => {
  const m = /(opus|sonnet|haiku)/.exec(model ?? '');
  return (m?.[1] ?? 'other') as 'opus' | 'sonnet' | 'haiku' | 'other';
};

/** Agents : ceux qui tournent (lancés sans arrêt correspondant depuis moins de six heures) et le bilan par type d'agent. */
export function agentsOf(events: readonly FrameworkEvent[], now: Date): { running: AgentRow[]; stats: AgentStat[] } {
  const open = new Map<string, AgentRow>();
  const stats = new Map<string, AgentStat>();
  for (const e of events) {
    const type = e.agentType ?? 'agent';
    const s = stats.get(type) ?? { type, runs: 0, tokens: 0 };
    if (e.type === 'agent.spawn') {
      s.runs += 1;
      if (e.agentId) open.set(e.agentId, { type, ...(e.model ? { model: e.model } : {}), ...(e.taskId ? { taskId: e.taskId } : {}), since: e.ts });
    } else if (e.type === 'agent.stop') {
      s.tokens += tokensOf(e);
      if (e.agentId) open.delete(e.agentId);
    } else continue;
    stats.set(type, s);
  }
  const running = [...open.values()].filter((a) => now.getTime() - Date.parse(a.since) < STALE_MS).sort((a, b) => Date.parse(b.since) - Date.parse(a.since));
  return { running, stats: [...stats.values()].sort((a, b) => b.tokens - a.tokens || b.runs - a.runs) };
}

/** Jetons réellement consommés par les sous-agents (lus dans leur transcription), par jour et par modèle, sur 30 jours. */
export function usageOf(events: readonly FrameworkEvent[], now: Date, days = 30): UsageSummary {
  const today = Date.parse(dayKey(now.getTime()));
  const byDay = new Map<string, { opus: number; sonnet: number; haiku: number; other: number }>();
  for (let i = 0; i < days; i++) byDay.set(dayKey(today - (days - 1 - i) * DAY), { opus: 0, sonnet: 0, haiku: 0, other: 0 });
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const e of events) {
    const u = e.type === 'agent.stop' ? (e.data?.['usage'] as { model?: string; input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | undefined) : undefined;
    const row = u ? byDay.get(e.ts.slice(0, 10)) : undefined;
    if (!u || !row) continue;
    row[family(u.model ?? e.model)] += (u.input ?? 0) + (u.output ?? 0);
    totals.input += u.input ?? 0;
    totals.output += u.output ?? 0;
    totals.cacheRead += u.cacheRead ?? 0;
    totals.cacheWrite += u.cacheWrite ?? 0;
  }
  return { days: [...byDay.entries()].map(([day, v]) => ({ day, ...v })), totals };
}

const SERIES_DAYS = 30;
const SERIES_GROUPS = 8;

/** Tâches restant à faire à la fin de chaque jour, pour les chantiers les plus chargés (burndown par incrément et relief). */
export function groupSeriesOf(tasks: readonly Task[], by: 'chantier' | 'type', now: Date): { days: string[]; series: GroupSeries[] } {
  const today = Date.parse(dayKey(now.getTime()));
  const days = Array.from({ length: SERIES_DAYS }, (_, i) => today - (SERIES_DAYS - 1 - i) * DAY);
  const groups = new Map<string, Task[]>();
  for (const t of live(tasks)) groups.set(groupKey(t, by), [...(groups.get(groupKey(t, by)) ?? []), t]);
  const series = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, SERIES_GROUPS).map(([name, list]) => ({
    name,
    remaining: days.map((d) => list.filter((t) => ms(t.createdAt) < d + DAY && !(t.status === 'done' && ms(t.updatedAt) < d + DAY)).length),
  }));
  return { days: days.map(dayKey), series };
}
