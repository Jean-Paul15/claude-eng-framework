import { spawn } from 'node:child_process';
import * as path from 'node:path';
import type { BrainStore } from '../brain/store.js';

/**
 * Frein de limite d'usage : quand la limite du compte interrompt une session, le routage devient économe (budget « economy », un
 * seul agent à la fois, Opus seulement pour les décisions) jusqu'à la réinitialisation ; et, si l'humain l'a demandé
 * (`ceng config auto-resume on`), le travail reprend tout seul après la réinitialisation, en mode sans humain.
 */

/** Durée par défaut de la fenêtre d'usage du compte (heures) quand le message d'erreur ne donne pas l'heure de réinitialisation. */
export const DEFAULT_WINDOW_HOURS = 5;
const MARGIN_MS = 2 * 60_000;

export const isUsageLimit = (type: string): boolean => /rate_limit|usage_limit|limit/i.test(type);

export function activeThrottle(store: BrainStore, now = Date.now()): { since: string; until: string } | undefined {
  const t = store.state().throttle;
  return t && Date.parse(t.until) > now ? t : undefined;
}

export function setThrottle(store: BrainStore, hours = DEFAULT_WINDOW_HOURS, now = Date.now()): void {
  store.updateState((s) => {
    s.throttle = { since: new Date(now).toISOString(), until: new Date(now + hours * 3_600_000).toISOString() };
  });
}

export function clearThrottle(store: BrainStore): void {
  store.updateState((s) => {
    delete s.throttle;
    delete s.resumeAt;
  });
}

/** Millisecondes à attendre avant la reprise : jusqu'à la réinitialisation (marge comprise), sinon `fallbackMs`. */
export function waitUntilReset(store: BrainStore, fallbackMs: number, now = Date.now()): number {
  const t = store.state().throttle;
  const until = t ? Date.parse(t.until) : NaN;
  return Number.isFinite(until) && until + MARGIN_MS > now ? until + MARGIN_MS - now : fallbackMs;
}

/**
 * Reprise automatique : un processus détaché attend la réinitialisation puis relance le travail sans humain. Une seule en attente par
 * projet ; elle s'annule si l'humain a repris la main entre-temps (voir `shouldAbortResume`).
 */
export function scheduleResume(store: BrainStore): boolean {
  if (store.config().autoResume?.enabled !== true || store.state().resumeAt) return false;
  const cli = path.join(store.paths.root, '.ceng', 'runtime', 'cli.js');
  store.updateState((s) => {
    s.resumeAt = new Date().toISOString();
  });
  const child = spawn(process.execPath, [cli, 'run', '--resume-after-limit', '--dir', store.paths.root], { cwd: store.paths.root, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  store.log({ type: 'session.interrupted', data: { resumeScheduled: true } });
  return true;
}

/** L'humain a déjà repris (une session a démarré après l'interruption) : la reprise automatique n'a plus lieu d'être. */
export function shouldAbortResume(store: BrainStore): boolean {
  const s = store.state();
  return Boolean(s.interruption && s.lastSessionAt && Date.parse(s.lastSessionAt) > Date.parse(s.interruption.at));
}
