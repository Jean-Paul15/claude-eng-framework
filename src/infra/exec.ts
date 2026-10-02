import { spawnSync } from 'node:child_process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

/** Exécute un binaire avec des arguments séparés (pas de shell → pas d'injection). */
export function run(cmd: string, args: string[], opts: { cwd: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; input?: string } ): ExecResult {
  const start = Date.now();
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 60_000,
    env: opts.env ?? process.env,
    input: opts.input,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    code: r.status ?? (r.error ? 127 : 1),
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? (r.error ? String(r.error.message) : ''),
    timedOut: r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT',
    durationMs: Date.now() - start,
  };
}

/**
 * Exécute une commande de gate issue de la configuration du projet (ex. `npm run lint`).
 * Le shell est nécessaire (scripts, pipes) ; la commande provient de `.ceng/config.json`,
 * fichier de gouvernance que les agents ne peuvent pas modifier sans approbation humaine.
 */
export function runShell(command: string, opts: { cwd: string; timeoutMs?: number }): ExecResult {
  const start = Date.now();
  const r = spawnSync(command, {
    cwd: opts.cwd,
    shell: true,
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 15 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    code: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? (r.error ? String(r.error.message) : ''),
    timedOut: r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT',
    durationMs: Date.now() - start,
  };
}

export function tail(text: string, lines: number): string {
  const all = text.split(/\r?\n/);
  return all.slice(Math.max(0, all.length - lines)).join('\n');
}
