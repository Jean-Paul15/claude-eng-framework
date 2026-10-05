import * as fs from 'node:fs';
import { sleepSync } from './sleep.js';

/**
 * Verrou fichier inter-processus (O_EXCL). Plusieurs subagents parallèles peuvent appeler la CLI
 * en même temps : sans verrou, deux `task done` simultanés écraseraient tasks.json.
 */
const STALE_MS = 15_000;

export function withLock<T>(lockPath: string, fn: () => T, timeoutMs = 10_000): T {
  const deadline = Date.now() + timeoutMs;
  let delay = 10;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > STALE_MS) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() > deadline) throw new Error(`Verrou ${lockPath} non obtenu après ${timeoutMs} ms (un autre processus ceng est-il bloqué ?)`);
      sleepSync(delay);
      delay = Math.min(delay * 2, 200);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}
