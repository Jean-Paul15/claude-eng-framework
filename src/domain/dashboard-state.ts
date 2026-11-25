import { agentsOf, backlogOf, boardOf, cfdOf, funnelOf, ganttBars, groupSeriesOf, metricsOf, slowdownsOf, usageOf } from './dashboard-agile.js';
import type { ActiveTask, DashboardState, DayPoint, FeedItem, WaitingItem } from './dashboard-types.js';
import type { FrameworkEvent } from './events.js';
import { attemptsByModel, gateTallies, groupProgress, statusCounts } from './report-stats.js';
import type { Task } from './types.js';

export type { ActiveTask, DashboardState, DayPoint, FeedItem, WaitingItem } from './dashboard-types.js';

/**
 * État du tableau de bord : tout ce que la page affiche, calculé en une fois à partir du cerveau du projet (fonctions pures).
 * Le même objet alimente la page vivante (poussé à chaque changement) et l'instantané statique (`ceng report --html`).
 */

export interface DashboardInput {
  project: string;
  now: Date;
  tasks: readonly Task[];
  /** Journal complet : le flux cumulé et les agents le rejouent ; le fil d'activité n'en lit que la fin. */
  events: readonly FrameworkEvent[];
  /** Date du dernier événement (toutes natures, fichiers édités compris) et nombre total d'événements. */
  activity: { last?: string; total: number };
  /** Incréments (chantiers) déjà clôturés par `ceng increment close`. */
  closedIncrements: readonly string[];
  featureStatuses: readonly string[];
  waiting: readonly WaitingItem[];
  specCoverage?: { total: number; open: number };
  /** Captures par tâche, chemins relatifs à `.ceng/shots/`. */
  shots: Readonly<Record<string, readonly string[]>>;
}

/** Fenêtre de l'historique d'activité (douze semaines). */
export const WINDOW_DAYS = 84;
const FEED_SIZE = 25;
const WAITING_SHOWN = 40;
const DAY_MS = 86_400_000;

const dayKey = (d: Date | string): string => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);

/** Une entrée par jour sur la fenêtre, zéros compris ; les cumuls partent du nombre déjà atteint avant la fenêtre. */
export function dailySeries(tasks: readonly Task[], now: Date, days = WINDOW_DAYS): DayPoint[] {
  const live = tasks.filter((t) => t.status !== 'cancelled');
  const today = Date.parse(dayKey(now));
  const first = today - (days - 1) * DAY_MS;
  const created = new Map<string, number>();
  const done = new Map<string, number>();
  let doneBefore = 0;
  let createdBefore = 0;
  const bump = (m: Map<string, number>, iso: string, before: () => void) => {
    const t = Date.parse(dayKey(iso));
    if (!Number.isFinite(t)) return;
    if (t < first) before();
    else m.set(dayKey(iso), (m.get(dayKey(iso)) ?? 0) + 1);
  };
  for (const t of live) {
    bump(created, t.createdAt, () => { createdBefore += 1; });
    if (t.status === 'done') bump(done, t.updatedAt, () => { doneBefore += 1; });
  }
  let doneCum = doneBefore;
  let createdCum = createdBefore;
  return Array.from({ length: days }, (_, i) => {
    const day = dayKey(new Date(first + i * DAY_MS));
    const d = done.get(day) ?? 0;
    const c = created.get(day) ?? 0;
    doneCum += d;
    createdCum += c;
    return { day, done: d, created: c, doneCum, createdCum };
  });
}

export function activeTasks(tasks: readonly Task[]): ActiveTask[] {
  return tasks.filter((t) => t.status === 'in_progress').map((t) => {
    const a = t.attempts[t.attempts.length - 1];
    return { id: t.id, title: t.title, kind: t.kind, ...(a?.model ? { model: a.model } : {}), ...(a?.agent ? { agent: a.agent } : {}), since: a?.startedAt ?? t.updatedAt };
  });
}

/** Événements du journal en phrases courtes ; le bruit (fichiers édités, verdicts de garde, contrôles de code) n'est pas montré. */
export function feed(events: readonly FrameworkEvent[], titles: ReadonlyMap<string, string>): FeedItem[] {
  const out: FeedItem[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < FEED_SIZE; i--) {
    const e = events[i]!;
    const item = describe(e, e.taskId ? titles.get(e.taskId) : undefined);
    if (item) out.push(item);
  }
  return out;
}

function describe(e: FrameworkEvent, title: string | undefined): FeedItem | undefined {
  const who = e.taskId ? `${e.taskId}${title ? ` · ${title}` : ''}` : '';
  const at = (text: string, tone: FeedItem['tone']): FeedItem => ({ ts: e.ts, text, tone, ...(e.taskId ? { taskId: e.taskId } : {}) });
  const d = e.data ?? {};
  switch (e.type) {
    case 'task.created': return at(`${who} créée`, 'info');
    case 'task.started': return at(`${who} démarrée${e.model ? ` (${e.model})` : ''}`, 'info');
    case 'task.done': return at(`${who} terminée`, 'good');
    case 'task.failed': return at(`${who} en échec`, 'warn');
    case 'task.blocked': return at(`${who} bloquée`, 'warn');
    case 'agent.spawn': return at(`Agent ${e.agentType ?? ''}${e.model ? ` (${e.model})` : ''} lancé${who ? ` pour ${e.taskId}` : ''}`, 'info');
    case 'gate.result': return d['status'] === 'fail' ? at(`Contrôle ${String(d['gate'])} en échec sur ${e.taskId ?? 'une tâche'}`, 'warn') : d['status'] === 'pass' ? at(`Contrôle ${String(d['gate'])} réussi sur ${e.taskId ?? 'une tâche'}`, 'good') : undefined;
    case 'decision.recorded': return at('Décision enregistrée', 'info');
    case 'escalation.opened': return at('Escalade ouverte : une décision est demandée', 'warn');
    case 'escalation.resolved': return at('Escalade résolue', 'good');
    case 'session.start': return at('Session démarrée', 'info');
    case 'checkpoint': return at('Point de reprise enregistré', 'info');
    case 'rollback': return at('Retour en arrière', 'warn');
    case 'conflict.detected': return at('Conflit de fichiers détecté entre deux agents', 'warn');
    default: return undefined;
  }
}

export function buildDashboardState(i: DashboardInput): DashboardState {
  const counts = statusCounts(i.tasks);
  const titles = new Map(i.tasks.map((t) => [t.id, t.title]));
  const groups = groupProgress(i.tasks);
  const daily = dailySeries(i.tasks, i.now);
  const series = groupSeriesOf(i.tasks, groups.by, i.now);
  const bySource: Record<string, number> = {};
  for (const w of i.waiting) bySource[w.source] = (bySource[w.source] ?? 0) + 1;
  const features: Record<string, number> = {};
  for (const s of i.featureStatuses) features[s] = (features[s] ?? 0) + 1;
  return {
    project: i.project,
    generatedAt: i.now.toISOString(),
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    activity: i.activity,
    daily,
    groups,
    seriesDays: series.days,
    groupSeries: series.series,
    closedIncrements: [...i.closedIncrements],
    gates: gateTallies(i.tasks),
    models: attemptsByModel(i.tasks),
    active: activeTasks(i.tasks),
    bars: ganttBars(i.tasks, i.now, groups.by),
    board: boardOf(i.tasks),
    metrics: metricsOf(i.tasks, daily, i.now),
    funnel: funnelOf(i.tasks),
    backlog: backlogOf(i.tasks, groups.by),
    cfd: cfdOf(i.tasks, i.events, i.now),
    slow: slowdownsOf(i.tasks, i.now),
    agents: agentsOf(i.events, i.now),
    usage: usageOf(i.events, i.now),
    waiting: { total: i.waiting.length, blocking: i.waiting.filter((w) => w.level === 'blocking').length, confirm: i.waiting.filter((w) => w.level === 'confirm').length, bySource, items: i.waiting.slice(0, WAITING_SHOWN).map((w) => ({ ...w })) },
    feed: feed(i.events, titles),
    features,
    ...(i.specCoverage ? { spec: i.specCoverage } : {}),
    tasks: i.tasks.filter((t) => t.status !== 'cancelled').map((t) => ({ id: t.id, title: t.title, kind: t.kind, status: t.status, attempts: t.attempts.length })),
    shots: Object.fromEntries(Object.entries(i.shots).filter(([, f]) => f.length).map(([k, f]) => [k, f.slice(0, 24)])),
  };
}
