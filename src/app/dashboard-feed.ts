import * as fs from 'node:fs';
import type * as http from 'node:http';
import type { BrainStore } from '../brain/store.js';
import type { DashboardState } from '../domain/dashboard-state.js';
import { loadDashboardState } from './dashboard.js';

/**
 * Flux d'état d'un projet : recalcule l'état quand le dossier `.ceng/` change (surveillance du système de fichiers, regroupée par
 * 120 ms, avec un sondage de sécurité) et ne pousse aux navigateurs abonnés que ce qui a réellement changé.
 */

/** Délai de regroupement des rafales d'écritures : assez court pour que la page suive chaque action de l'agent. */
const DEBOUNCE_MS = 120;
const SAFETY_POLL_MS = 5000;
const NO_WATCH_POLL_MS = 3000;
const KEEPALIVE_MS = 15_000;
/** Ce qui change dans `.ceng/` sans concerner l'avancement : ne déclenche pas de recalcul. */
const IGNORED = /^(report|runtime|shots|dashboard\.json|locks?)([\\/]|$)/;

const fingerprint = (s: DashboardState): string => JSON.stringify({ ...s, generatedAt: '' });

export class ProjectFeed {
  state: DashboardState;
  private key: string;
  private readonly clients = new Set<http.ServerResponse>();
  private timer: NodeJS.Timeout | undefined;
  private watcher: fs.FSWatcher | undefined;
  private intervals: NodeJS.Timeout[] = [];

  constructor(readonly store: BrainStore) {
    this.state = loadDashboardState(store);
    this.key = fingerprint(this.state);
  }

  /** Abonne un navigateur (flux d'événements serveur) : il reçoit d'emblée l'état courant. */
  subscribe(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
    res.write(`retry: 2000\ndata: ${JSON.stringify(this.state)}\n\n`);
    this.clients.add(res);
    req.on('close', () => this.clients.delete(res));
  }

  refresh = (): void => {
    try {
      const next = loadDashboardState(this.store);
      const nextKey = fingerprint(next);
      if (nextKey === this.key) return;
      this.state = next;
      this.key = nextKey;
      const payload = `data: ${JSON.stringify(next)}\n\n`;
      for (const c of this.clients) c.write(payload);
    } catch {
      // un fichier en cours d'écriture : on réessaie au prochain changement
    }
  };

  private schedule = (): void => {
    clearTimeout(this.timer);
    this.timer = setTimeout(this.refresh, DEBOUNCE_MS);
  };

  start(): void {
    try {
      this.watcher = fs.watch(this.store.paths.ceng, { recursive: true }, (_event, file) => {
        if (!file || !IGNORED.test(file.toString())) this.schedule();
      });
      this.watcher.on('error', () => undefined);
    } catch {
      // surveillance récursive indisponible : le sondage de sécurité suffit
    }
    this.intervals = [
      setInterval(this.refresh, this.watcher ? SAFETY_POLL_MS : NO_WATCH_POLL_MS),
      setInterval(() => { for (const c of this.clients) c.write(': ping\n\n'); }, KEEPALIVE_MS),
    ];
  }

  stop(): void {
    clearTimeout(this.timer);
    for (const i of this.intervals) clearInterval(i);
    this.watcher?.close();
    for (const c of this.clients) c.end();
    this.clients.clear();
  }
}
