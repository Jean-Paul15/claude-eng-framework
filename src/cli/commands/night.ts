import * as fs from 'node:fs';
import * as path from 'node:path';
import { readyTasks } from '../../domain/taskgraph.js';
import { pendingApprovalsCount, pendingApprovalsPath } from '../../app/unattended.js';
import { statusCounts } from '../../brain/brief.js';
import type { BrainStore } from '../../brain/store.js';
import { ensureDir, readText } from '../../infra/fs.js';
import { UsageError } from '../args.js';
import { spawnClaude } from './run.js';

/**
 * `ceng run --unattended` : travail sans humain (la nuit). Relance Claude Code en mode non interactif tant qu'il
 * reste des tâches faisables, qu'il progresse et que les limites (heures, relances, budget) ne sont pas atteintes.
 * Aucune invite de permission n'attend personne (`--permission-prompts none`) ; les actions à approbation sont
 * refusées et consignées par les hooks (CENG_UNATTENDED=1). Une interruption (limite d'usage, surcharge) est suivie
 * d'une attente puis d'une reprise depuis le Project Brain.
 */

export interface UnattendedOptions {
  model?: string;
  goal?: string;
  maxHours: number;
  maxRuns: number;
  waitMinutes: number;
  maxBudgetUsd?: string;
  permissionMode: string;
  dryRun: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function remainingWork(store: BrainStore): number {
  const tasks = store.tasks();
  return readyTasks(tasks).length + tasks.filter((t) => t.status === 'in_progress').length;
}

function signature(store: BrainStore): string {
  return store.tasks().map((t) => `${t.id}:${t.status}:${t.attempts.length}`).join('|');
}

function objectiveDefined(store: BrainStore): boolean {
  return !(readText(store.paths.objective) ?? '').includes('_Non défini.');
}

export function buildUnattendedArgs(store: BrainStore, opts: UnattendedOptions, first: boolean): string[] {
  const model = opts.model ?? store.config().policy.orchestratorModel;
  const prompt = first && opts.goal
    ? `/ceng-orchestrate MODE SANS HUMAIN — personne ne peut répondre : ne pose aucune question, consigne tes hypothèses dans assumptions.md. Objectif : ${opts.goal}`
    : '/ceng-orchestrate MODE SANS HUMAIN — reprends le travail depuis le Project Brain et enchaîne les tâches faisables ; ne pose aucune question.';
  const args = ['-p', prompt, '--model', model, '--permission-mode', opts.permissionMode, '--permission-prompts', 'none', '--output-format', 'text'];
  if (opts.maxBudgetUsd) args.push('--max-budget-usd', opts.maxBudgetUsd);
  return args;
}

export async function runUnattended(store: BrainStore, opts: UnattendedOptions): Promise<void> {
  if (store.tasks().length === 0 && !objectiveDefined(store) && !opts.goal) {
    throw new UsageError('Mode sans humain : aucun objectif ni tâche. Donner --goal "…" ou cadrer le projet d\'abord en session interactive.');
  }
  if (opts.dryRun) {
    process.stdout.write(`CENG_UNATTENDED=1 claude ${buildUnattendedArgs(store, opts, true).map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}\n`);
    return;
  }
  ensureDir(store.paths.logs);
  const logPath = path.join(store.paths.logs, `unattended-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  const deadline = Date.now() + opts.maxHours * 3_600_000;
  const env = { ...process.env, CENG_UNATTENDED: '1' };
  let stalls = 0;
  let run = 0;
  const say = (m: string) => process.stdout.write(`[ceng nuit ${new Date().toLocaleTimeString()}] ${m}\n`);
  say(`démarrage — limites : ${opts.maxHours} h, ${opts.maxRuns} relances${opts.maxBudgetUsd ? `, ${opts.maxBudgetUsd} $ par relance` : ''}. Journal : ${store.paths.rel(logPath)}`);
  store.updateState((s) => {
    delete s.unattended;
    // Un message humain antérieur ne doit pas faire croire à une présence pendant la nuit.
    delete s.lastHumanAt;
    delete s.humanAwaySignalAt;
  });

  while (run < opts.maxRuns && Date.now() < deadline) {
    if (run > 0 && remainingWork(store) === 0) {
      say('plus aucune tâche faisable.');
      break;
    }
    const before = signature(store);
    store.updateState((s) => {
      delete s.interruption;
    });
    run += 1;
    say(`relance ${run} — ${remainingWork(store)} tâche(s) faisable(s)`);
    store.log({ type: 'unattended.run', data: { run } });
    const fd = fs.openSync(logPath, 'a');
    const code = await spawnClaude(store.paths.root, buildUnattendedArgs(store, opts, run === 1), { stdio: ['ignore', fd, fd], env });
    fs.closeSync(fd);
    const interruption = store.state().interruption;
    if (interruption && ['rate_limit', 'overloaded', 'server_error'].includes(interruption.type)) {
      say(`interruption (${interruption.type}) : attente ${opts.waitMinutes} min puis reprise.`);
      await sleep(opts.waitMinutes * 60_000);
      continue;
    }
    stalls = signature(store) === before ? stalls + 1 : 0;
    if (code !== 0) say(`Claude Code s'est arrêté avec le code ${code}.`);
    if (stalls >= 2) {
      say('aucune progression sur 2 relances : arrêt pour ne pas consommer inutilement.');
      break;
    }
  }

  const counts = statusCounts(store.tasks());
  const pending = pendingApprovalsCount(store);
  say(`fin — ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'aucune tâche'}`);
  if (pending) say(`${pending} action(s) attendent ta validation : ${store.paths.rel(pendingApprovalsPath(store))}`);
  say(`détail : \`ceng report\` · journal complet : ${store.paths.rel(logPath)}`);
}
