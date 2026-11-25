import { spawn } from 'node:child_process';
import type { BrainStore } from '../brain/store.js';
import { sleepSync } from '../infra/sleep.js';
import { runningDashboard } from './dashboard-server.js';

/**
 * Lance le tableau de bord d'un projet en arrière-plan s'il ne tourne pas déjà, et rend son adresse (ou `undefined` si le serveur n'a
 * pas répondu à temps). Sert au démarrage de session (`config dashboard on`) et à `ceng dashboard --background`.
 */
export function ensureDashboard(store: BrainStore, cli: string, waitMs: number): string | undefined {
  const running = runningDashboard(store);
  if (running) return running.url;
  spawn(process.execPath, [cli, 'dashboard', '--dir', store.paths.root, '--no-open'], { cwd: store.paths.root, detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => undefined).unref();
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    sleepSync(100);
    const up = runningDashboard(store);
    if (up) return up.url;
  }
  return undefined;
}
