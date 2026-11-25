import type { GateTally, GroupProgress, LiveStatus } from './report-stats.js';
import type { ModelTier } from './types.js';

/** Forme de l'état du tableau de bord : ce que le serveur calcule et que la page affiche (voir dashboard-state.ts). */

export interface DayPoint {
  day: string;
  done: number;
  created: number;
  /** Totaux cumulés depuis le début du projet (le début de la fenêtre inclus). */
  doneCum: number;
  createdCum: number;
}

export interface ActiveTask {
  id: string;
  title: string;
  kind: string;
  model?: ModelTier;
  agent?: string;
  since: string;
}

/** Une barre du diagramme de Gantt : du premier essai à la fin (ou à maintenant), avec ses dépendances. */
export interface GanttBar {
  id: string;
  title: string;
  status: string;
  group: string;
  start: string;
  end: string;
  deps: string[];
}

export interface BoardCard {
  id: string;
  title: string;
  kind: string;
  status: string;
  model?: ModelTier;
  reason?: string;
  attempts: number;
  updatedAt: string;
}

/** Tableau scrum : quatre colonnes ; les colonnes longues sont tronquées (le nombre masqué est donné). */
export interface Board {
  pending: BoardCard[];
  in_progress: BoardCard[];
  blocked: BoardCard[];
  done: BoardCard[];
  hidden: { pending: number; blocked: number; done: number };
}

export interface Metrics {
  doneLast7: number;
  donePrev7: number;
  createdLast7: number;
  /** Tâches terminées par semaine, moyenne des 28 derniers jours. */
  perWeek: number;
  /** Durée médiane d'une tâche terminée (premier essai → fin), en heures. */
  cycleMedianHours?: number;
  open: number;
  wip: number;
  blocked: number;
  /** Fin prévue si le rythme des 28 derniers jours se maintient (absente sans rythme ou au-delà de deux ans). */
  forecast?: { days: number; date: string };
}

export interface Funnel {
  created: number;
  started: number;
  done: number;
  /** Terminées sans dérogation ni contrôle en échec. */
  clean: number;
}

export interface BacklogItem {
  id: string;
  title: string;
  kind: string;
  group: string;
  /** Tâches non terminées dont celle-ci dépend. */
  waitingFor: string[];
  /** Nombre de tâches qu'elle débloque (transitivement). */
  unlocks: number;
  reason?: string;
}

/** Backlog en trois bandes : maintenant (en cours), ensuite (prêtes), plus tard (attendent une tâche), et ce qui attend un humain. */
export interface Backlog {
  now: BacklogItem[];
  next: BacklogItem[];
  later: BacklogItem[];
  human: BacklogItem[];
}

export interface CfdPoint {
  day: string;
  pending: number;
  in_progress: number;
  blocked: number;
  failed: number;
  done: number;
}

export interface StuckItem {
  id: string;
  title: string;
  status: string;
  days: number;
  reason?: string;
}

/** « Ce qui a ralenti » : tâches restées à l'arrêt le plus longtemps et contrôles qui échouent. */
export interface Slowdowns {
  stuck: StuckItem[];
  gates: { gate: string; fail: number; total: number }[];
}

export interface AgentRow {
  type: string;
  model?: string;
  taskId?: string;
  since: string;
}

export interface AgentStat {
  type: string;
  runs: number;
  tokens: number;
}

export interface UsageDay {
  day: string;
  opus: number;
  sonnet: number;
  haiku: number;
  other: number;
}

export interface UsageSummary {
  days: UsageDay[];
  totals: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export interface GroupSeries {
  name: string;
  /** Tâches restant à faire à la fin de chaque jour de `seriesDays`. */
  remaining: number[];
}

export interface WaitingItem {
  level: 'blocking' | 'confirm';
  source: string;
  question: string;
}

export interface FeedItem {
  ts: string;
  text: string;
  tone: 'good' | 'warn' | 'info';
  taskId?: string;
}

export interface DashboardState {
  project: string;
  generatedAt: string;
  counts: Record<LiveStatus, number>;
  total: number;
  /** Dernière action de l'agent et nombre d'actions : la page bouge à chaque action. */
  activity: { last?: string; total: number };
  daily: DayPoint[];
  groups: { by: 'chantier' | 'type'; rows: GroupProgress[] };
  seriesDays: string[];
  groupSeries: GroupSeries[];
  closedIncrements: string[];
  gates: GateTally[];
  models: Record<ModelTier, number>;
  active: ActiveTask[];
  bars: GanttBar[];
  board: Board;
  metrics: Metrics;
  funnel: Funnel;
  backlog: Backlog;
  cfd: CfdPoint[];
  slow: Slowdowns;
  agents: { running: AgentRow[]; stats: AgentStat[] };
  usage: UsageSummary;
  waiting: { total: number; blocking: number; confirm: number; bySource: Record<string, number>; items: WaitingItem[] };
  feed: FeedItem[];
  features: Record<string, number>;
  spec?: { total: number; open: number };
  tasks: { id: string; title: string; kind: string; status: string; attempts: number }[];
  shots: Record<string, string[]>;
}
