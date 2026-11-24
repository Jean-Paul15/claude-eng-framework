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
import { secretsCommand } from './cli/commands/secrets.js';
import { configCommand } from './cli/commands/config.js';
import { relayCommand, teamCommand } from './cli/commands/team.js';
import { bypassCommand } from './cli/commands/bypass.js';
import { advisorCommand } from './cli/commands/advisor.js';
import { depCommand } from './cli/commands/dep.js';
import { featureCommand } from './cli/commands/feature.js';
import { storeCommand } from './cli/commands/store.js';
import { costCommand, perfCommand } from './cli/commands/economy.js';
import { verifyCommand } from './cli/commands/verify.js';
import { contractCommand, inboxCommand, incrementCommand } from './cli/commands/governance.js';
import { ruleCommand } from './cli/commands/rule.js';
import { complianceCommand } from './cli/commands/compliance.js';
import { dataMapCommand, readyCommand } from './cli/commands/ready.js';
import { upgradeAll } from './cli/commands/upgrade-all.js';
import { briefCommand, similarCommand } from './cli/commands/context.js';

const HELP = `ceng — framework d'ingénierie autonome pour Claude Code

Installation & lancement
  init [--yes] [--dry-run] [--goal "…"] [--risk|--autonomy|--budget|--parallelism …] [--code-graph on|off] [--install-graphify]
  run [--goal "…"] [--model opus|sonnet] [--headless] [--resume] [--dry-run]          Ouvre la session orchestrateur
  upgrade [--all] | doctor | profile | uninstall --yes [--purge]   (--all : tous les projets de cette machine ; sinon mise à jour auto au démarrage de session)

Travail (utilisé par l'orchestrateur et les agents)
  task add --title … --kind … [--complexity 1-5 --risk --ambiguity --novelty --arch --context S|M|L]
           [--files "glob,glob"] [--deps T-0001] [--accept "critère"]… [--domains payments,auth] [--interfaces api:/x]
  task list|show|next|start|done --evidence …|fail --reason …|block --reason …|unblock|cancel <id>
  route <id>                 Décision expliquée : agent, modèle, effort, revue, tests, gates, escalade
  plan [--charter "mission"] Lots exécutables : direct / séquentiel / subagents parallèles / Agent Team
  gate list|run <id> [--only lint,unit] · gate record <id> <gate> pass|fail --note …
  similar <termes…>          Existant proche (fichiers, symboles) à réutiliser AVANT de créer — évite les doublons
  brief <id>                 Paquet de délégation minimal : fichiers à toucher, références, existant, décisions, critères
  conflicts                  Fichiers touchés par plusieurs agents / hors périmètre

Mémoire & reprise
  status · resume · checkpoint --done … --next … [--task id] · checkpoint list · rollback <CP> [--apply]
  escalate <id> --problem … --tried … --decision … · escalate resolve <E> --decision …
  decision add --title … --context … --decision … --consequences …

Observabilité & amélioration
  log [--task id] [--type prefix] [--tail n] · report · adapt [--apply] · learn add|list|promote · skill new <nom>

Commandes de gates
  config detect [--apply]    Commandes recommandées pour la vraie pile du projet ; --apply les écrit dans .ceng/config.json (validation humaine)
  config stage [prototype|production]   Stade du projet : prototype = sans validation pour ce qui est récupérable (changement : validation humaine)

Bypass total (décision humaine)
  bypass status|on|off       Aucune validation ni refus (bypassPermissions) ; journal et instantanés conservés
  feature add|list|show|reject|replace|import  Registre des fonctionnalités (décidées, en cours, livrées, écartées)
  ready                      Contrôle « prêt pour la production » (variables d'environnement, secrets, CI, santé, conformité…)
  compliance status|set|waive  Socle de conformité (politiques, consentements, conservation, audit, anomalies, incidents)
  data-map                   Carte des données personnelles générée depuis les migrations
  rule add|list|remove       Règles de contrôle du code propres au projet (une erreur relevée ne se réécrit plus)
  inbox                      Tout ce qui attend l'humain (décisions bloquantes, à confirmer), trié
  contract freeze|bump|list  Contrats partagés gelés : un sous-agent ne les modifie pas
  increment close <groupe>   Clôture d'un incrément (tout terminé, vu, testé) et rapport
  verify                     Vérification après déploiement (commands.smoke)
  perf show|reset            Références de performance (la gate performance compare chaque mesure)
  cost [add …] [--users N]   Registre des coûts de production et facture mensuelle estimée
  store check                Motifs de rejet Apple détectables (permissions, connexion Apple, suppression de compte)
  dep check [noms…]|list|baseline  Vérifie les dépendances (licence, maintenance, vulnérabilités, usage) dans les registres publics
  advisor [fable|opus|sonnet|off]  Conseiller de Claude Code (modèle plus fort consulté aux décisions clés), lancé avec --advisor

Équipe de sessions (plusieurs agents en parallèle)
  team status|on|off [--allow mcp__serveur__outil] [--defer mcp__serveur__outil]
                             Équipe autonome : le framework tranche les permissions à la place d'un humain absent (liste de sécurité fermée)
  relay emit --kind opus-ready|opus-done|blocked|decision-needed|custom --session <nom> [--ref <fichier>] [--note "…"]
  relay watch [--interval 5] [--replay] [--human]   La coordination attend ; une ligne par événement (à brancher sur Monitor)
  relay events [--all] · relay ack [--upto N]

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
    case 'upgrade': return rest.includes('--all') ? upgradeAll(rest.filter((a) => a !== '--all')) : initCommand(['--yes', ...rest], 'upgrade');
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
    case 'secrets': return secretsCommand(rest);
    case 'config': return configCommand(rest);
    case 'team': return teamCommand(rest);
    case 'bypass': return bypassCommand(rest);
    case 'advisor': return advisorCommand(rest);
    case 'dep': return depCommand(rest);
    case 'feature': return featureCommand(rest);
    case 'store': return storeCommand(rest);
    case 'perf': return perfCommand(rest);
    case 'cost': return costCommand(rest);
    case 'verify': return verifyCommand(rest);
    case 'contract': return contractCommand(rest);
    case 'inbox': return inboxCommand(rest);
    case 'increment': return incrementCommand(rest);
    case 'rule': return ruleCommand(rest);
    case 'compliance': return complianceCommand(rest);
    case 'ready': return readyCommand(rest);
    case 'data-map': return dataMapCommand(rest);
    case 'similar': return similarCommand(rest);
    case 'brief': return briefCommand(rest);
    case 'relay': return relayCommand(rest);
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
