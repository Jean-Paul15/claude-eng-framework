#!/usr/bin/env node
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UsageError } from './cli/args.js';
import { doctorCommand, initCommand, profileCommand, uninstallCommand } from './cli/commands/setup.js';
import { runCommand } from './cli/commands/run.js';
import { conflictsCommand, gateCommand, planCommand, routeCommand, taskCommand } from './cli/commands/work.js';
import { adaptCommand, checkpointCommand, decisionCommand, escalateCommand, learnCommand, logCommand, reportCommand, resumeCommand, rollbackCommand, skillCommand, statusCommand } from './cli/commands/memory.js';
import { runHook } from './hooks/run.js';
import { graphCommand } from './cli/commands/graph.js';

const HELP = `ceng — framework d'ingénierie autonome pour Claude Code

Installation & lancement
  init [--yes] [--dry-run] [--goal "…"] [--risk|--autonomy|--budget|--parallelism …] [--code-graph on|off] [--install-graphify]
  run [--goal "…"] [--model opus|sonnet] [--headless] [--resume] [--dry-run]          Ouvre la session orchestrateur
  upgrade | doctor | profile | uninstall --yes [--purge]

Travail (utilisé par l'orchestrateur et les agents)
  task add --title … --kind … [--complexity 1-5 --risk --ambiguity --novelty --arch --context S|M|L]
           [--files "glob,glob"] [--deps T-0001] [--accept "critère"]… [--domains payments,auth] [--interfaces api:/x]
  task list|show|next|start|done --evidence …|fail --reason …|block --reason …|unblock|cancel <id>
  route <id>                 Décision expliquée : agent, modèle, effort, revue, tests, gates, escalade
  plan [--charter "mission"] Lots exécutables : direct / séquentiel / subagents parallèles / Agent Team
  gate list|run <id> [--only lint,unit] · gate record <id> <gate> pass|fail --note …
  conflicts                  Fichiers touchés par plusieurs agents / hors périmètre

Mémoire & reprise
  status · resume · checkpoint --done … --next … [--task id] · checkpoint list · rollback <CP> [--apply]
  escalate <id> --problem … --tried … --decision … · escalate resolve <E> --decision …
  decision add --title … --context … --decision … --consequences …

Observabilité & amélioration
  log [--task id] [--type prefix] [--tail n] · report · adapt [--apply] · learn add|list|promote · skill new <nom>

Graphe de code (graphify, sans coût IA)
  graph status|install|build|enable|disable   Construit et maintenu automatiquement par les hooks

Options communes : --json (sortie machine), --dir <projet>`;

export async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(`${HELP}\n`);
      return;
    case '--version':
    case 'version': {
      const { locateFramework } = await import('./generation/install.js');
      process.stdout.write(`${locateFramework()?.version ?? 'runtime'}\n`);
      return;
    }
    case 'init': return initCommand(rest, 'init');
    case 'upgrade': return initCommand(['--yes', ...rest], 'upgrade');
    case 'run': return runCommand(rest);
    case 'doctor': return doctorCommand(rest);
    case 'profile': return profileCommand(rest);
    case 'uninstall': return uninstallCommand(rest);
    case 'task': return taskCommand(rest);
    case 'route': return routeCommand(rest);
    case 'plan': return planCommand(rest);
    case 'gate': return gateCommand(rest);
    case 'conflicts': return conflictsCommand(rest);
    case 'status': return statusCommand(rest);
    case 'resume': return resumeCommand(rest);
    case 'checkpoint': return checkpointCommand(rest);
    case 'rollback': return rollbackCommand(rest);
    case 'escalate': return escalateCommand(rest);
    case 'decision': return decisionCommand(rest);
    case 'log': return logCommand(rest);
    case 'report': return reportCommand(rest);
    case 'adapt': return adaptCommand(rest);
    case 'learn': return learnCommand(rest);
    case 'skill': return skillCommand(rest);
    case 'graph': return graphCommand(rest);
    case 'hook': {
      const chunks: Buffer[] = [];
      if (!process.stdin.isTTY) for await (const c of process.stdin) chunks.push(c as Buffer);
      const res = await runHook(rest[0] ?? '', Buffer.concat(chunks).toString('utf8'));
      if (res.json) process.stdout.write(JSON.stringify(res.json));
      if (res.stderr) process.stderr.write(`${res.stderr}\n`);
      process.exitCode = res.exitCode;
      return;
    }
    default:
      throw new UsageError(`Commande inconnue : ${cmd}. Voir \`ceng help\`.`);
  }
}

function invokedDirectly(): boolean {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    const e = err as Error;
    process.stderr.write(`ceng : ${e.message}\n`);
    process.exitCode = err instanceof UsageError ? 2 : 1;
  });
}
