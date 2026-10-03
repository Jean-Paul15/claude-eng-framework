import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { run as exec } from '../../infra/exec.js';
import { BrainStore } from '../../brain/store.js';
import { bool, parse, str, UsageError, type Parsed } from '../args.js';
import { runUnattended } from './night.js';

function num(p: Parsed, key: string, fallback: number): number {
  const v = str(p, key);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new UsageError(`--${key} doit être un nombre positif.`);
  return n;
}

/**
 * `ceng run` : ouvre la session d'entrée (le modèle avec lequel l'humain parle) sur le modèle
 * recommandé par la politique, avec le protocole d'orchestration chargé. Ensuite, chaque délégation
 * choisit son propre modèle : le modèle d'entrée ne contraint pas l'exécution.
 */

export interface LaunchPlan {
  bin: string;
  args: string[];
  shell: boolean;
  model: string;
  notes: string[];
}

function resolveClaude(cwd: string): { bin: string; viaCmd: boolean } {
  if (process.platform !== 'win32') return { bin: 'claude', viaCmd: false };
  const r = exec('where', ['claude'], { cwd, timeoutMs: 5000 });
  const candidates = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const exe = candidates.find((c) => c.toLowerCase().endsWith('.exe'));
  if (exe) return { bin: exe, viaCmd: false };
  const cmd = candidates.find((c) => /\.(cmd|bat)$/i.test(c));
  if (cmd) return { bin: cmd, viaCmd: true };
  throw new UsageError('Claude Code introuvable dans le PATH (installer : https://code.claude.com/docs/en/setup).');
}

/** Échappement pour cmd.exe (seulement quand claude est un .cmd) : guillemets doublés et métacaractères neutralisés. */
export function quoteForCmd(arg: string): string {
  return `"${arg.replace(/"/g, '""').replace(/([%^&|<>!])/g, '^$1')}"`;
}

export function buildLaunchPlan(store: BrainStore, opts: { model?: string; goal?: string; headless?: boolean; resume?: boolean; effort?: string }): Omit<LaunchPlan, 'bin' | 'shell'> {
  const config = store.config();
  const model = opts.model ?? config.policy.orchestratorModel;
  const notes: string[] = [];
  const args: string[] = ['--model', model];
  if (opts.effort) args.push('--effort', opts.effort);
  const prompt = `/ceng-orchestrate${opts.goal ? ` ${opts.goal}` : ''}`;
  if (opts.resume) args.push('--continue');
  if (opts.headless) {
    const mode = config.policy.autonomy === 'supervised' ? 'default' : 'acceptEdits';
    args.unshift('-p', prompt);
    args.push('--permission-mode', mode, '--output-format', 'json');
    notes.push(`Mode non interactif : permission-mode ${mode}, pas d'Agent Teams (limitation Claude Code), actions à approbation refusées.`);
  } else if (!opts.resume || opts.goal) {
    args.push(prompt);
  }
  notes.push(`Orchestrateur : ${model}${opts.model ? ' (forcé)' : ' (recommandé par la politique)'} ; les workers choisissent leur modèle par délégation.`);
  return { args, model, notes };
}

/** Lance Claude Code et attend sa fin. Renvoie le code de sortie. */
export function spawnClaude(root: string, args: string[], opts: { stdio: 'inherit' | ['ignore', number, number]; env?: NodeJS.ProcessEnv }): Promise<number> {
  const { bin, viaCmd } = resolveClaude(root);
  const common = { cwd: root, stdio: opts.stdio, env: opts.env ?? process.env };
  const child = viaCmd
    ? spawn(process.env['ComSpec'] ?? 'cmd.exe', ['/d', '/s', '/c', [quoteForCmd(bin), ...args.map(quoteForCmd)].join(' ')], { ...common, windowsVerbatimArguments: true })
    : spawn(bin, args, common);
  return new Promise<number>((resolve) => {
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', (err) => {
      process.stderr.write(`[ceng] impossible de lancer Claude Code : ${err.message}
`);
      resolve(1);
    });
  });
}

export async function runCommand(argv: string[]): Promise<void> {
  const p = parse(argv, {
    model: { type: 'string' }, goal: { type: 'string' }, headless: { type: 'boolean' }, resume: { type: 'boolean' }, effort: { type: 'string' },
    'dry-run': { type: 'boolean' }, dir: { type: 'string' },
    unattended: { type: 'boolean' }, 'max-hours': { type: 'string' }, 'max-runs': { type: 'string' }, 'max-budget-usd': { type: 'string' },
    'permission-mode': { type: 'string' }, 'wait-minutes': { type: 'string' },
  });
  const root = path.resolve(str(p, 'dir') ?? process.cwd());
  const store = new BrainStore(root);
  store.requireInitialized();
  const model = str(p, 'model');
  if (model && !/^(opus|sonnet|haiku|fable|best|opusplan|claude-[\w.-]+)(\[1m\])?$/.test(model)) throw new UsageError(`--model invalide : ${model}`);
  const effort = str(p, 'effort');
  if (effort && !['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) throw new UsageError('--effort : low|medium|high|xhigh|max');
  const goal = str(p, 'goal');
  if (bool(p, 'unattended')) {
    await runUnattended(store, {
      ...(model ? { model } : {}), ...(goal ? { goal } : {}),
      maxHours: num(p, 'max-hours', 10), maxRuns: num(p, 'max-runs', 30), waitMinutes: num(p, 'wait-minutes', 15),
      ...(str(p, 'max-budget-usd') ? { maxBudgetUsd: str(p, 'max-budget-usd')! } : {}),
      permissionMode: str(p, 'permission-mode') ?? 'auto',
      dryRun: bool(p, 'dry-run'),
    });
    return;
  }
  const plan = buildLaunchPlan(store, { ...(model ? { model } : {}), ...(goal ? { goal } : {}), headless: bool(p, 'headless'), resume: bool(p, 'resume'), ...(effort ? { effort } : {}) });
  for (const n of plan.notes) process.stderr.write(`[ceng] ${n}\n`);
  if (bool(p, 'dry-run')) {
    process.stdout.write(`claude ${plan.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}\n`);
    return;
  }
  process.exitCode = await spawnClaude(root, plan.args, { stdio: 'inherit' });
}
