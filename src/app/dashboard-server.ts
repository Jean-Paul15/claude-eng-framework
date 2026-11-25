import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import type { BrainStore } from '../brain/store.js';
import { renderDashboardPage, renderHomePage } from '../generation/dashboard-page.js';
import { readJson, writeTextAtomic } from '../infra/fs.js';
import { ProjectFeed } from './dashboard-feed.js';
import { loadDashboardState } from './dashboard.js';
import { cengHome } from './registry.js';

/**
 * Serveur local du tableau de bord : la page se met à jour toute seule pendant que le travail avance.
 * Un projet : tout est à la racine (`/`). Plusieurs projets (`ceng dashboard --all`) : accueil à `/`, chaque projet sous `/p/<n>/`.
 *
 * Sécurité : lecture seule (GET uniquement), écoute sur 127.0.0.1 exclusivement, en-tête `Host` vérifié (parade au « DNS rebinding »),
 * aucun en-tête CORS (une autre page web ne peut pas lire les réponses), politique de contenu stricte. L'état est déjà expurgé des secrets.
 */

const HOST = '127.0.0.1';
const PORT_BASE = 4700;
const PORT_SPAN = 100;
const PORT_TRIES = 20;
const HOME_TTL_MS = 3000;

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data: blob:; font-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'";

export interface RunningDashboard {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** Port préféré, stable pour un projet donné (l'adresse reste la même d'une fois sur l'autre : on peut la mettre en favori). */
export function stablePort(projectRoot: string): number {
  const h = crypto.createHash('sha1').update(path.resolve(projectRoot).toLowerCase()).digest();
  return PORT_BASE + (h.readUInt16BE(0) % PORT_SPAN);
}

function listen(server: http.Server, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => (err.code === 'EADDRINUSE' ? resolve(false) : reject(err)));
    server.listen(port, HOST, () => resolve(true));
  });
}

export interface StartOptions {
  port?: number;
  /** Projets servis sous `/p/<n>/` avec une page d'accueil, au lieu d'un projet unique à la racine. */
  all?: readonly BrainStore[];
}

export async function startDashboard(store: BrainStore, opts: StartOptions = {}): Promise<RunningDashboard> {
  const multi = opts.all !== undefined;
  const stores = multi ? [...opts.all!] : [store];
  const feeds = new Map<number, ProjectFeed>();
  let allowed = new Set<string>();
  let home: { at: number; body: string } | undefined;

  const feedOf = (i: number): ProjectFeed | undefined => {
    const s = stores[i];
    if (!s) return undefined;
    let f = feeds.get(i);
    if (!f) {
      f = new ProjectFeed(s);
      f.start();
      feeds.set(i, f);
    }
    return f;
  };
  if (!multi) feedOf(0);

  const send = (res: http.ServerResponse, code: number, type: string, body: string | Buffer, extra: http.OutgoingHttpHeaders = {}): void => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP, ...extra });
    res.end(body);
  };
  const text = (res: http.ServerResponse, code: number, body: string) => send(res, code, 'text/plain; charset=utf-8', body);

  const projectsSummary = (): string => {
    if (home && Date.now() - home.at < HOME_TTL_MS) return home.body;
    const rows = stores.map((s, i) => {
      const st = feeds.get(i)?.state ?? loadDashboardState(s);
      return { index: i, name: st.project, root: s.paths.root, total: st.total, done: st.counts.done, inProgress: st.counts.in_progress, blocked: st.counts.blocked + st.counts.failed, waiting: st.waiting.total, last: st.activity.last ?? null };
    });
    home = { at: Date.now(), body: JSON.stringify(rows) };
    return home.body;
  };

  const serveShot = (res: http.ServerResponse, feed: ProjectFeed, rel: string): void => {
    const dir = path.join(feed.store.paths.ceng, 'shots');
    const file = path.resolve(dir, rel);
    const type = MIME[path.extname(file).toLowerCase()];
    if (!type || !file.startsWith(dir + path.sep) || !fs.existsSync(file)) return text(res, 404, 'Introuvable');
    send(res, 200, type, fs.readFileSync(file));
  };

  const serveProject = (req: http.IncomingMessage, res: http.ServerResponse, feed: ProjectFeed, sub: string): void => {
    if (sub === '/') return send(res, 200, 'text/html; charset=utf-8', renderDashboardPage(feed.state, 'live'));
    if (sub === '/api/state') return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(feed.state));
    if (sub === '/events') return feed.subscribe(req, res);
    if (sub.startsWith('/shots/')) {
      try {
        return serveShot(res, feed, decodeURIComponent(sub.slice('/shots/'.length)));
      } catch {
        return text(res, 400, 'Chemin invalide');
      }
    }
    return text(res, 404, 'Introuvable');
  };

  const handler = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    if (!allowed.has(req.headers.host ?? '')) return text(res, 403, 'Hôte non autorisé');
    if (req.method !== 'GET') return text(res, 405, 'Lecture seule');
    const pathname = new URL(req.url ?? '/', `http://${HOST}`).pathname;
    if (!multi) return serveProject(req, res, feedOf(0)!, pathname);
    if (pathname === '/') return send(res, 200, 'text/html; charset=utf-8', renderHomePage());
    if (pathname === '/api/projects') return send(res, 200, 'application/json; charset=utf-8', projectsSummary());
    const m = /^\/p\/(\d+)(\/.*)?$/.exec(pathname);
    const feed = m ? feedOf(Number(m[1])) : undefined;
    if (!m || !feed) return text(res, 404, 'Introuvable');
    if (m[2] === undefined) return send(res, 301, 'text/plain; charset=utf-8', '', { Location: `/p/${m[1]}/` });
    return serveProject(req, res, feed, m[2]);
  };

  const server = http.createServer(handler);
  const preferred = opts.port ?? (multi ? PORT_BASE : stablePort(store.paths.root));
  let port = -1;
  for (let i = 0; i < PORT_TRIES && port < 0; i++) if (await listen(server, preferred === 0 ? 0 : preferred + i)) port = (server.address() as { port: number }).port;
  if (port < 0 && (await listen(server, 0))) port = (server.address() as { port: number }).port;
  if (port < 0) throw new Error('Aucun port local disponible pour le tableau de bord.');
  allowed = new Set([`${HOST}:${port}`, `localhost:${port}`]);

  const registry = multi ? path.join(cengHome(), 'dashboard-all.json') : path.join(store.paths.ceng, 'dashboard.json');
  writeTextAtomic(registry, JSON.stringify({ port, pid: process.pid, startedAt: new Date().toISOString() }));

  return {
    port,
    url: `http://${HOST}:${port}/`,
    close: () => new Promise((resolve) => {
      for (const f of feeds.values()) f.stop();
      try {
        if (readJson<{ pid: number }>(registry)?.pid === process.pid) fs.rmSync(registry, { force: true });
      } catch {
        // déjà supprimé
      }
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

export interface DashboardRecord {
  port: number;
  pid: number;
  startedAt: string;
}

function readRunning(file: string): (DashboardRecord & { url: string }) | undefined {
  const rec = readJson<DashboardRecord>(file);
  if (!rec || !Number.isInteger(rec.pid)) return undefined;
  try {
    process.kill(rec.pid, 0);
  } catch {
    return undefined;
  }
  return { ...rec, url: `http://${HOST}:${rec.port}/` };
}

/** Tableau de bord déjà lancé pour ce projet (processus vivant), sinon `undefined`. */
export const runningDashboard = (store: BrainStore) => readRunning(path.join(store.paths.ceng, 'dashboard.json'));

/** Accueil multi-projets déjà lancé sur cette machine, sinon `undefined`. */
export const runningHome = () => readRunning(path.join(cengHome(), 'dashboard-all.json'));
