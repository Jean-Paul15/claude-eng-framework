import * as path from 'node:path';
import { adapt } from '../../domain/adaptation.js';
import { normalizeTopic, promotionCandidates, type Learning, type LearningKind } from '../../domain/learning.js';
import { nextId } from '../../domain/taskgraph.js';
import { applyRollback, createCheckpoint, planRollback } from '../../app/checkpoints.js';
import { openEscalation, recordDecision, resolveEscalation } from '../../app/coordination.js';
import { renderIndex, resumeBrief, statusCounts } from '../../brain/brief.js';
import { BrainStore } from '../../brain/store.js';
import { exists, writeTextAtomic } from '../../infra/fs.js';
import { yamlString } from '../../generation/project-skills.js';
import { bool, out, parse, requirePositional, requireStr, str, UsageError } from '../args.js';

function storeFor(dir?: string): BrainStore {
  const store = new BrainStore(path.resolve(dir ?? process.cwd()));
  store.requireInitialized();
  return store;
}

export function statusCommand(argv: string[]): void {
  const p = parse(argv, { dir: { type: 'string' } });
  const store = storeFor(str(p, 'dir'));
  const index = renderIndex(store);
  writeTextAtomic(store.paths.index, index);
  out(p, index, { counts: statusCounts(store.tasks()), state: store.state() });
}

export function resumeCommand(argv: string[]): void {
  const p = parse(argv, { dir: { type: 'string' } });
  const store = storeFor(str(p, 'dir'));
  const brief = resumeBrief(store, 'manual');
  const recent = store.checkpoints().slice(-3).map((c) => `- ${c.id} ${c.at}${c.taskId ? ` ${c.taskId}` : ''} : ${c.done} → ${c.next}`);
  out(p, `${brief}\n\nDerniers checkpoints :\n${recent.join('\n') || '- aucun'}`, { brief, checkpoints: store.checkpoints().slice(-3), state: store.state() });
}

export function checkpointCommand(argv: string[]): void {
  if (argv[0] === 'list') {
    const p = parse(argv.slice(1), { dir: { type: 'string' } });
    const cps = storeFor(str(p, 'dir')).checkpoints();
    out(p, cps.map((c) => `${c.id} ${c.at}${c.taskId ? ` ${c.taskId}` : ''}${c.auto ? ' (auto)' : ''}${c.snapshot ? ' [snapshot]' : ''} : ${c.done}`).join('\n') || 'Aucun checkpoint.', cps);
    return;
  }
  const p = parse(argv, { dir: { type: 'string' }, task: { type: 'string' }, done: { type: 'string' }, next: { type: 'string' }, failed: { type: 'string' }, notes: { type: 'string' }, 'no-snapshot': { type: 'boolean' } });
  const store = storeFor(str(p, 'dir'));
  const cp = createCheckpoint(store, {
    ...(str(p, 'task') ? { taskId: str(p, 'task')!.toUpperCase() } : {}),
    done: requireStr(p, 'done', 'ce qui est fait'),
    next: requireStr(p, 'next', 'la prochaine action précise'),
    ...(str(p, 'failed') ? { failed: str(p, 'failed')! } : {}),
    ...(str(p, 'notes') ? { notes: str(p, 'notes')! } : {}),
    snapshot: !bool(p, 'no-snapshot'),
  });
  writeTextAtomic(store.paths.index, renderIndex(store));
  out(p, `${cp.id} enregistré${cp.snapshot ? ` (instantané ${cp.snapshot.slice(0, 10)})` : ''}.`, cp);
}

export function rollbackCommand(argv: string[]): void {
  const p = parse(argv, { dir: { type: 'string' }, apply: { type: 'boolean' } });
  const store = storeFor(str(p, 'dir'));
  const id = requirePositional(p, 0, 'checkpoint');
  if (!bool(p, 'apply')) {
    const plan = planRollback(store, id);
    out(p, `Rollback vers ${plan.checkpoint.id} (${plan.checkpoint.done}) modifierait ${plan.changedFiles.length} fichier(s) :\n${plan.diffStat || plan.changedFiles.join('\n')}\n\nUn instantané de sécurité sera pris avant. Relancer avec --apply pour exécuter.`, plan);
    return;
  }
  const r = applyRollback(store, id);
  out(p, `Restauré. État précédent sauvegardé dans ${r.safety.id} (annulable).${r.createdKept.length ? `\nFichiers créés depuis, conservés : ${r.createdKept.join(', ')}` : ''}`, r);
}

export function escalateCommand(argv: string[]): void {
  if (argv[0] === 'resolve') {
    const p = parse(argv.slice(1), { dir: { type: 'string' }, decision: { type: 'string' } });
    const file = resolveEscalation(storeFor(str(p, 'dir')), requirePositional(p, 0, 'escalade'), requireStr(p, 'decision'));
    out(p, `Escalade résolue : ${file}`, { file });
    return;
  }
  const p = parse(argv, { dir: { type: 'string' }, problem: { type: 'string' }, context: { type: 'string' }, tried: { type: 'string' }, results: { type: 'string' }, hypotheses: { type: 'string' }, decision: { type: 'string' } });
  const store = storeFor(str(p, 'dir'));
  const file = openEscalation(store, {
    taskId: requirePositional(p, 0, 'tâche'),
    problem: requireStr(p, 'problem'),
    context: str(p, 'context') ?? '_voir tâche_',
    tried: requireStr(p, 'tried', 'tentatives effectuées'),
    results: str(p, 'results') ?? '_voir tentatives_',
    hypotheses: str(p, 'hypotheses') ?? '_aucune_',
    decisionNeeded: requireStr(p, 'decision', 'décision attendue'),
  });
  writeTextAtomic(store.paths.index, renderIndex(store));
  out(p, `ESCALATE_TO_OPUS ouvert : ${file}\nDéléguer à ceng-principal (model opus) avec UNIQUEMENT ce fichier comme contexte.`, { file });
}

export function decisionCommand(argv: string[]): void {
  const [sub, ...rest] = argv;
  if (sub !== 'add') throw new UsageError('ceng decision add --title … --context … --decision … --consequences …');
  const p = parse(rest, { dir: { type: 'string' }, title: { type: 'string' }, context: { type: 'string' }, decision: { type: 'string' }, consequences: { type: 'string' }, alternatives: { type: 'string' }, task: { type: 'string' } });
  const file = recordDecision(storeFor(str(p, 'dir')), {
    title: requireStr(p, 'title'),
    context: requireStr(p, 'context'),
    decision: requireStr(p, 'decision'),
    consequences: requireStr(p, 'consequences'),
    ...(str(p, 'alternatives') ? { alternatives: str(p, 'alternatives')! } : {}),
    ...(str(p, 'task') ? { taskId: str(p, 'task')!.toUpperCase() } : {}),
  });
  out(p, `Décision enregistrée : ${file}`, { file });
}

export function logCommand(argv: string[]): void {
  const p = parse(argv, { dir: { type: 'string' }, task: { type: 'string' }, type: { type: 'string' }, tail: { type: 'string' } });
  const store = storeFor(str(p, 'dir'));
  const n = Number.parseInt(str(p, 'tail') ?? '40', 10);
  const events = store.events()
    .filter((e) => !str(p, 'task') || e.taskId === str(p, 'task')!.toUpperCase())
    .filter((e) => !str(p, 'type') || e.type.startsWith(str(p, 'type')!))
    .slice(-n);
  const human = events.map((e) => `${e.ts.slice(0, 19)} ${e.type.padEnd(20)} ${e.taskId ?? ''} ${e.agentType ?? ''}${e.model ? `/${e.model}` : ''} ${e.data ? JSON.stringify(e.data).slice(0, 160) : ''}`).join('\n');
  out(p, human || 'Journal vide.', events);
}

/** Rapport d'observabilité : qui a travaillé, avec quel modèle, pourquoi, combien de tentatives, pourquoi terminé. */
export function reportCommand(argv: string[]): void {
  const p = parse(argv, { dir: { type: 'string' } });
  const store = storeFor(str(p, 'dir'));
  const events = store.events();
  const rows = store.tasks().map((t) => {
    const spawns = events.filter((e) => e.type === 'agent.spawn' && e.taskId === t.id && e.data?.['phase'] !== 'started');
    return {
      id: t.id,
      status: t.status,
      kind: t.kind,
      route: t.route ? `${t.route.executor === 'direct' ? 'direct' : t.route.implementer.agent}/${t.route.implementer.model}/${t.route.implementer.effort}` : '—',
      review: t.route?.reviewLevel ?? '—',
      attempts: t.attempts.length,
      failures: t.attempts.filter((a) => a.outcome === 'failure').length,
      escalated: events.some((e) => e.type === 'escalation.opened' && e.taskId === t.id),
      agents: [...new Set(spawns.map((e) => `${e.agentType}${e.model ? `/${e.model}` : ''}`))],
      gates: t.gates.map((g) => `${g.gate}:${g.status}`),
      doneBecause: t.status === 'done' ? `${t.evidence ?? ''}${t.waiver ? ` [dérogation : ${t.waiver}]` : ''}` : '',
    };
  });
  const byModel: Record<string, number> = {};
  for (const e of events.filter((x) => x.type === 'agent.spawn' && x.data?.['phase'] !== 'started')) byModel[e.model ?? 'inherit'] = (byModel[e.model ?? 'inherit'] ?? 0) + 1;
  const human = [
    `Délégations par modèle : ${Object.entries(byModel).map(([k, v]) => `${k}=${v}`).join(' · ') || 'aucune'}`,
    `Escalades : ${events.filter((e) => e.type === 'escalation.opened').length} · conflits : ${events.filter((e) => e.type === 'conflict.detected').length} · verdicts de garde : ${events.filter((e) => e.type === 'guard.verdict').length} · interruptions : ${events.filter((e) => e.type === 'session.interrupted').length}`,
    '',
    ...rows.map((r) => `${r.id} ${r.status.padEnd(11)} ${r.kind.padEnd(9)} ${r.route.padEnd(32)} revue=${r.review} tentatives=${r.attempts}${r.failures ? ` (échecs ${r.failures})` : ''}${r.escalated ? ' ESCALADÉE' : ''}\n     agents: ${r.agents.join(', ') || '—'} · gates: ${r.gates.join(' ') || '—'}${r.doneBecause ? `\n     terminé : ${r.doneBecause}` : ''}`),
  ].join('\n');
  out(p, human, { byModel, tasks: rows });
}

export function adaptCommand(argv: string[]): void {
  const p = parse(argv, { dir: { type: 'string' }, apply: { type: 'boolean' }, 'min-sample': { type: 'string' } });
  const store = storeFor(str(p, 'dir'));
  const config = store.config();
  const result = adapt({ events: store.events(), tasks: store.tasks(), policy: config.policy, installedSkills: config.installedSkills, minSample: Number.parseInt(str(p, 'min-sample') ?? '5', 10) });
  if (bool(p, 'apply') && result.overrides.reasons.length) {
    store.saveOverrides(result.overrides);
    store.log({ type: 'adaptation.applied', data: { reasons: result.overrides.reasons } });
  }
  const human = [
    'Indicateurs :', ...Object.entries(result.stats).map(([k, v]) => `  ${k} = ${v}`),
    '', 'Ajustements :', ...(result.overrides.reasons.length ? result.overrides.reasons.map((r) => `  • ${r}`) : ['  aucun']),
    '', 'Recommandations :', ...result.recommendations.map((r) => `  • ${r}`),
    result.overrides.reasons.length && !bool(p, 'apply') ? '\n(simulation : relancer avec --apply pour enregistrer dans .ceng/adaptive.json)' : '',
  ].join('\n');
  out(p, human, result);
}

const LEARNING_KINDS: LearningKind[] = ['worked', 'failed', 'recurring-error', 'effective-decision', 'procedure'];

export function learnCommand(argv: string[]): void {
  const [sub, ...rest] = argv;
  const p = parse(rest, { dir: { type: 'string' }, kind: { type: 'string' }, topic: { type: 'string' }, lesson: { type: 'string' }, evidence: { type: 'string' }, source: { type: 'string' }, skill: { type: 'string' }, task: { type: 'string' }, min: { type: 'string' } });
  const store = storeFor(str(p, 'dir'));
  if (sub === 'add') {
    const kind = (str(p, 'kind') ?? 'worked') as LearningKind;
    if (!LEARNING_KINDS.includes(kind)) throw new UsageError(`--kind : ${LEARNING_KINDS.join('|')}`);
    const l: Learning = {
      id: nextId('L', store.learnings().map((x) => x.id)),
      at: new Date().toISOString(),
      kind,
      topic: normalizeTopic(requireStr(p, 'topic')),
      lesson: requireStr(p, 'lesson'),
      ...(str(p, 'task') ? { taskId: str(p, 'task')!.toUpperCase() } : {}),
      ...(str(p, 'evidence') ? { evidence: str(p, 'evidence')! } : {}),
      ...(str(p, 'source') ? { source: str(p, 'source')! } : {}),
      ...(str(p, 'skill') ? { skill: str(p, 'skill')! } : {}),
    };
    store.appendLearning(l);
    store.log({ type: 'learning.recorded', ...(l.taskId ? { taskId: l.taskId } : {}), data: { topic: l.topic, kind } });
    out(p, `${l.id} consigné (${l.topic}). Une leçon isolée n'est pas promue en règle.`, l);
    return;
  }
  if (sub === 'list') {
    const ls = store.learnings();
    out(p, ls.map((l) => `${l.id} [${l.kind}] ${l.topic} — ${l.lesson}`).join('\n') || 'Aucune leçon.', ls);
    return;
  }
  if (sub === 'promote') {
    const c = promotionCandidates(store.learnings(), Number.parseInt(str(p, 'min') ?? '3', 10));
    const human = c.length
      ? c.map((x) => `• ${x.topic} → ${x.targetSkill ?? 'nouvelle skill ou skill existante à choisir'}\n  ${x.justification}\n  Leçons : ${x.lessons.join(' | ')}`).join('\n') + '\n\nAppliquer via la skill ceng-skill-forge (justification écrite, validation humaine si autonomie ≠ high).'
      : 'Aucune leçon suffisamment confirmée pour être promue.';
    out(p, human, c);
    return;
  }
  throw new UsageError('ceng learn add|list|promote');
}

/** Squelette de skill projet (le contenu est rédigé par l'agent via ceng-skill-forge). */
export function skillCommand(argv: string[]): void {
  const [sub, ...rest] = argv;
  const p = parse(rest, { dir: { type: 'string' }, description: { type: 'string' } });
  if (sub !== 'new') throw new UsageError('ceng skill new <nom> --description "…"');
  const store = storeFor(str(p, 'dir'));
  const name = requirePositional(p, 0, 'nom');
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(name)) throw new UsageError('Nom de skill : minuscules, chiffres, tirets.');
  const file = path.join(store.paths.root, '.claude', 'skills', name, 'SKILL.md');
  if (exists(file)) throw new UsageError(`La skill ${name} existe déjà.`);
  writeTextAtomic(file, `---\nname: ${name}\ndescription: ${yamlString(requireStr(p, 'description'))}\nmetadata:\n  ceng-tier: project\n  ceng-status: draft\n---\n\n# ${name}\n\n## Quand l'utiliser\n\n## Procédure\n\n## Pièges\n\n## Sources\n`);
  const config = store.config();
  if (!config.installedSkills.includes(name)) store.saveConfig({ ...config, installedSkills: [...config.installedSkills, name] });
  out(p, `Squelette créé : .claude/skills/${name}/SKILL.md`, { file });
}
