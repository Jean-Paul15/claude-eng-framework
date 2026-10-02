import * as path from 'node:path';
import { planExecution } from '../../domain/planner.js';
import { readyTasks } from '../../domain/taskgraph.js';
import { GATE_IDS, TASK_STATUSES, type ContextSize, type GateId, type GateStatus, type ModelTier, type RouteDecision, type Task } from '../../domain/types.js';
import { blockTask, completeTask, createTask, csv, failAttempt, parseKind, parseLevel, routeAndStore, setStatus, startTask } from '../../app/tasks.js';
import { recordOutcomes, runGates } from '../../app/gates.js';
import { detectConflicts, writeTeamCharter } from '../../app/coordination.js';
import { BrainStore } from '../../brain/store.js';
import { renderIndex } from '../../brain/brief.js';
import { writeTextAtomic } from '../../infra/fs.js';
import { bool, out, parse, requirePositional, requireStr, str, UsageError } from '../args.js';

function storeFor(dir?: string): BrainStore {
  const store = new BrainStore(path.resolve(dir ?? process.cwd()));
  store.requireInitialized();
  return store;
}

function refreshIndex(store: BrainStore): void {
  writeTextAtomic(store.paths.index, renderIndex(store));
}

export function formatRoute(t: Task, r: RouteDecision): string {
  return [
    `${t.id} — ${t.title} [${t.kind}]`,
    `Exécution : ${r.executor === 'direct' ? 'directe (orchestrateur)' : `déléguée → ${r.implementer.agent}`} · modèle ${r.implementer.model} · effort ${r.implementer.effort} · coût relatif ${r.costIndex}`,
    `Revue : ${r.reviewLevel} · tests : ${r.testStrategy.flow}${r.testStrategy.types.length ? ` [${r.testStrategy.types.join(', ')}]` : ''}`,
    `Phases : ${r.phases.map((p) => `${p.step}(${p.agent === 'orchestrator' ? 'orch' : p.agent.replace('ceng-', '')}/${p.model})`).join(' → ')}`,
    `Gates : ${r.gates.map((g) => `${g.gate}${g.required ? '' : '?'}`).join(', ')}`,
    r.checkpointBefore ? 'Checkpoint AVANT modification.' : '',
    r.escalate.required ? `⚠ ESCALADE → ${r.escalate.to} : ${r.escalate.reason}` : '',
    r.humanApproval.required ? `⚠ APPROBATION HUMAINE : ${r.humanApproval.reason}` : '',
    'Pourquoi :',
    ...r.reasons.map((x) => `  - ${x}`),
  ].filter(Boolean).join('\n');
}

function taskLine(t: Task): string {
  const a = t.assessment;
  return `${t.id} ${t.status.padEnd(11)} [${t.kind}] ${t.title}  (c${a.complexity} r${a.risk} a${a.ambiguity}${t.deps.length ? ` ← ${t.deps.join(',')}` : ''})`;
}

const TASK_FLAGS = {
  title: { type: 'string' }, kind: { type: 'string' }, complexity: { type: 'string' }, risk: { type: 'string' }, ambiguity: { type: 'string' },
  novelty: { type: 'string' }, arch: { type: 'string' }, context: { type: 'string' }, files: { type: 'string' }, deps: { type: 'string' },
  accept: { type: 'string', multiple: true }, domains: { type: 'string' }, interfaces: { type: 'string' }, group: { type: 'string' },
  status: { type: 'string' }, evidence: { type: 'string' }, waive: { type: 'string' }, reason: { type: 'string' }, agent: { type: 'string' },
  model: { type: 'string' }, strategy: { type: 'string' }, dir: { type: 'string' },
} as const;

export function taskCommand(argv: string[]): void {
  const [sub, ...rest] = argv;
  const p = parse(rest, TASK_FLAGS);
  const store = storeFor(str(p, 'dir'));
  switch (sub) {
    case 'add': {
      const context = (str(p, 'context') ?? 'M').toUpperCase() as ContextSize;
      if (!['S', 'M', 'L'].includes(context)) throw new UsageError('--context : S|M|L');
      const t = createTask(store, {
        title: requireStr(p, 'title'),
        kind: parseKind(str(p, 'kind')),
        assessment: {
          complexity: parseLevel(str(p, 'complexity'), 'complexity', 2),
          risk: parseLevel(str(p, 'risk'), 'risk', 2),
          ambiguity: parseLevel(str(p, 'ambiguity'), 'ambiguity', 2),
          novelty: parseLevel(str(p, 'novelty'), 'novelty', 1),
          architecturalImpact: parseLevel(str(p, 'arch'), 'arch', 1),
          contextSize: context,
        },
        files: csv(str(p, 'files')),
        deps: csv(str(p, 'deps')),
        acceptance: (p.values['accept'] as string[] | undefined) ?? [],
        domains: csv(str(p, 'domains')),
        interfaces: csv(str(p, 'interfaces')),
        ...(str(p, 'group') ? { group: str(p, 'group')! } : {}),
      });
      refreshIndex(store);
      out(p, `${t.id} créée : ${t.title}`, t);
      return;
    }
    case 'list': {
      const status = str(p, 'status');
      if (status && !(TASK_STATUSES as readonly string[]).includes(status)) throw new UsageError(`--status : ${TASK_STATUSES.join('|')}`);
      const tasks = store.tasks().filter((t) => !status || t.status === status);
      out(p, tasks.map(taskLine).join('\n') || 'Aucune tâche.', tasks);
      return;
    }
    case 'show': {
      const t = store.task(requirePositional(p, 0, 'tâche'));
      const human = [
        taskLine(t),
        t.acceptance.length ? `Acceptation : ${t.acceptance.join(' ; ')}` : '',
        t.files.length ? `Fichiers : ${t.files.join(', ')}` : 'Fichiers : non déclarés',
        t.domains.length ? `Domaines : ${t.domains.join(', ')}` : '',
        ...t.attempts.map((a) => `  tentative ${a.n} ${a.agent}/${a.model} ${a.outcome}${a.reason ? ` — ${a.reason}` : ''}`),
        ...t.gates.map((g) => `  gate ${g.gate}: ${g.status}${g.required ? '' : ' (optionnelle)'}`),
        t.route ? `\n${formatRoute(t, t.route)}` : '',
      ].filter(Boolean).join('\n');
      out(p, human, t);
      return;
    }
    case 'next': {
      const ready = readyTasks(store.tasks());
      out(p, ready.map(taskLine).join('\n') || 'Aucune tâche prête.', ready);
      return;
    }
    case 'start': {
      const model = str(p, 'model') as ModelTier | undefined;
      if (model && !['haiku', 'sonnet', 'opus'].includes(model)) throw new UsageError('--model : haiku|sonnet|opus');
      const t = startTask(store, requirePositional(p, 0, 'tâche'), str(p, 'agent'), model, str(p, 'strategy'));
      refreshIndex(store);
      out(p, `${t.id} démarrée (tentative ${t.attempts.length}).\n${formatRoute(t, t.route!)}`, t);
      return;
    }
    case 'done': {
      const t = completeTask(store, requirePositional(p, 0, 'tâche'), requireStr(p, 'evidence', 'preuve : tests/gates/commit'), str(p, 'waive'));
      refreshIndex(store);
      out(p, `${t.id} terminée.${t.waiver ? ` Dérogation : ${t.waiver}` : ''}`, t);
      return;
    }
    case 'fail': {
      const t = failAttempt(store, requirePositional(p, 0, 'tâche'), requireStr(p, 'reason'));
      refreshIndex(store);
      const r = t.route!;
      out(p, `${t.id} : échec consigné (${t.attempts.filter((a) => a.outcome === 'failure').length} échec(s)).${r.escalate.required ? `\n⚠ ESCALADE requise → ${r.escalate.to} (\`ceng escalate ${t.id} …\`)` : '\nNouvelle tentative avec une stratégie différente (consigner --strategy).'}`, t);
      return;
    }
    case 'block': {
      const t = blockTask(store, requirePositional(p, 0, 'tâche'), requireStr(p, 'reason'));
      refreshIndex(store);
      out(p, `${t.id} bloquée : ${t.blockedReason}`, t);
      return;
    }
    case 'unblock':
    case 'cancel': {
      const t = setStatus(store, requirePositional(p, 0, 'tâche'), sub === 'unblock' ? 'pending' : 'cancelled', str(p, 'reason'));
      refreshIndex(store);
      out(p, `${t.id} → ${t.status}`, t);
      return;
    }
    default:
      throw new UsageError('ceng task add|list|show|next|start|done|fail|block|unblock|cancel');
  }
}

export function routeCommand(argv: string[]): void {
  const p = parse(argv, { dir: { type: 'string' } });
  const store = storeFor(str(p, 'dir'));
  const t = routeAndStore(store, requirePositional(p, 0, 'tâche'));
  out(p, formatRoute(t, t.route!), t.route);
}

export function planCommand(argv: string[]): void {
  const p = parse(argv, { dir: { type: 'string' }, interactive: { type: 'boolean' }, charter: { type: 'string' } });
  const store = storeFor(str(p, 'dir'));
  const config = store.config();
  const overrides = store.overrides();
  // Les teams n'existent qu'en session interactive avec la variable activée.
  const teamsAvailable = config.policy.parallelism === 'teams' && (bool(p, 'interactive') || process.env['CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'] === '1');
  const plan = planExecution(store.tasks(), { policy: config.policy, ...(overrides ? { overrides } : {}), teamsAvailable });
  // Router les tâches planifiées pour que l'orchestrateur ait agent/modèle sans appel supplémentaire.
  const routed = plan.batches.flatMap((b) => b.tasks).map((id) => routeAndStore(store, id));
  store.log({ type: 'plan.computed', data: { modes: plan.batches.map((b) => b.mode), batches: plan.batches.map((b) => b.tasks), deferred: plan.deferred.length } });
  let charter: string | undefined;
  const team = plan.batches.find((b) => b.mode === 'agent-team');
  if (team && str(p, 'charter')) charter = writeTeamCharter(store, routed.filter((t) => team.tasks.includes(t.id)), str(p, 'charter')!);
  const human = [
    ...plan.reasons,
    ...plan.batches.map((b, i) => [
      `\nLot ${i + 1} — ${b.mode}${b.isolation === 'worktree' ? ' (worktrees isolés)' : ''}`,
      ...b.tasks.map((id) => {
        const t = routed.find((x) => x.id === id)!;
        return `  ${id} ${t.title} → ${t.route!.executor === 'direct' ? 'direct' : `${t.route!.implementer.agent}/${t.route!.implementer.model}/${t.route!.implementer.effort}`}`;
      }),
      ...b.reasons.map((r) => `  · ${r}`),
    ].join('\n')),
    plan.deferred.length ? `\nReportées : ${plan.deferred.map((d) => `${d.task} (${d.reason})`).join(' ; ')}` : '',
    team && !charter ? '\nAgent Team proposée : écrire la charte avec `ceng plan --charter "mission"` avant de lancer les teammates.' : '',
    charter ? `\nCharte d'équipe : ${charter}` : '',
  ].filter(Boolean).join('\n');
  out(p, human, { ...plan, charter });
}

export function gateCommand(argv: string[]): void {
  const [sub, ...rest] = argv;
  const p = parse(rest, { dir: { type: 'string' }, only: { type: 'string' }, note: { type: 'string' } });
  const store = storeFor(str(p, 'dir'));
  if (sub === 'run' || sub === 'list') {
    const id = requirePositional(p, 0, 'tâche');
    if (sub === 'list') {
      const t = store.task(id);
      const route = t.route ?? routeAndStore(store, id).route!;
      out(p, route.gates.map((g) => `${g.gate.padEnd(20)} ${g.required ? 'requise   ' : 'optionnelle'} ${g.why}`).join('\n'), route.gates);
      return;
    }
    const only = csv(str(p, 'only')) as GateId[];
    const outcomes = runGates(store, id, only.length ? only : undefined);
    const blocking = outcomes.filter((o) => o.required && !['pass', 'skipped'].includes(o.status));
    const human = [
      ...outcomes.map((o) => `${o.status === 'pass' ? '✔' : o.status === 'fail' ? '✖' : o.status === 'skipped' ? '–' : '…'} ${o.gate.padEnd(20)} ${o.status}${o.required ? '' : ' (optionnelle)'}\n    ${o.detail.split('\n').join('\n    ')}`),
      '',
      blocking.length ? `Bloquant : ${blocking.map((b) => `${b.gate}(${b.status})`).join(', ')}` : 'Toutes les gates requises sont satisfaites (ou non applicables).',
    ].join('\n');
    out(p, human, outcomes);
    if (blocking.some((b) => b.status === 'fail')) process.exitCode = 1;
    return;
  }
  if (sub === 'record') {
    const id = requirePositional(p, 0, 'tâche');
    const gate = requirePositional(p, 1, 'gate') as GateId;
    const status = requirePositional(p, 2, 'pass|fail|waived') as GateStatus;
    if (!(GATE_IDS as readonly string[]).includes(gate)) throw new UsageError(`gate inconnue : ${gate}`);
    if (!['pass', 'fail', 'waived'].includes(status)) throw new UsageError('statut : pass|fail|waived');
    const t = store.task(id);
    const req = t.route?.gates.find((g) => g.gate === gate);
    const note = requireStr(p, 'note', 'qui a vérifié quoi, constats');
    recordOutcomes(store, t.id, [{ gate, status, required: req?.required ?? false, detail: note }]);
    out(p, `${t.id} · ${gate} = ${status}`, { gate, status });
    return;
  }
  throw new UsageError('ceng gate run|list|record <tâche> …');
}

export function conflictsCommand(argv: string[]): void {
  const p = parse(argv, { dir: { type: 'string' }, since: { type: 'string' } });
  const store = storeFor(str(p, 'dir'));
  const conflicts = detectConflicts(store, str(p, 'since'));
  const human = conflicts.length
    ? conflicts.map((c) => `✖ ${c.file} — agents : ${c.agents.join(', ')}${c.outOfScope.length ? ` · hors périmètre : ${c.outOfScope.map((o) => o.task ?? o.agent).join(', ')}` : ''}`).join('\n')
    : 'Aucun conflit détecté depuis le dernier checkpoint.';
  out(p, human, conflicts);
  if (conflicts.length) process.exitCode = 1;
}
