import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PREFERENCES, reconcile } from '../src/domain/policy.js';
import type { Assessment, EffectivePolicy, Preferences, Task } from '../src/domain/types.js';

export const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXAMPLES = path.join(FRAMEWORK_ROOT, 'examples');
export const CLI = path.join(FRAMEWORK_ROOT, 'dist', 'src', 'cli.js');

export function task(id: string, over: Partial<Omit<Task, 'assessment'>> & { assessment?: Partial<Assessment> } = {}): Task {
  const { assessment, ...rest } = over;
  return {
    id,
    title: `Tâche ${id}`,
    kind: 'feature',
    status: 'pending',
    assessment: { complexity: 2, risk: 2, ambiguity: 2, novelty: 1, architecturalImpact: 1, contextSize: 'M', ...assessment },
    files: [],
    deps: [],
    acceptance: ['ok'],
    domains: [],
    interfaces: [],
    attempts: [],
    gates: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...rest,
  };
}

export function policy(prefs: Partial<Preferences> = {}, domains: string[] = [], detected: Preferences['riskLevel'] = 'medium'): EffectivePolicy {
  return reconcile({ ...DEFAULT_PREFERENCES, ...prefs }, { detectedRisk: detected, domains, interactiveTeamsPossible: true });
}

/** Copie un projet de démo dans un dossier temporaire, avec un dépôt git initialisé. */
export function sandbox(example: string, withGit = true): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ceng-${example}-`));
  fs.cpSync(path.join(EXAMPLES, example), dir, { recursive: true });
  if (withGit) {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('config', 'commit.gpgsign', 'false');
    git('add', '-A');
    git('commit', '-q', '-m', 'feat: initial');
  }
  return dir;
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function cli(cwd: string, args: string[], input?: string): CliResult {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', stdio: 'pipe', input: input ?? '', env: { ...process.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '', CENG_NO_CODE_GRAPH: process.env['CENG_NO_CODE_GRAPH'] ?? '1' } });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

export function json<T>(r: CliResult): T {
  return JSON.parse(r.stdout) as T;
}

export function runtimeHook(projectDir: string, event: string, payload: unknown): CliResult {
  const runner = path.join(projectDir, '.ceng', 'runtime', 'hooks', 'run.js');
  try {
    const stdout = execFileSync(process.execPath, [runner, event], { cwd: projectDir, encoding: 'utf8', stdio: 'pipe', input: JSON.stringify(payload), env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CENG_NO_CODE_GRAPH: process.env['CENG_NO_CODE_GRAPH'] ?? '1' } });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

export function rm(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
}
