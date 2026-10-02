import * as path from 'node:path';
import { nextId } from '../domain/taskgraph.js';
import type { Task } from '../domain/types.js';
import { readText, writeTextAtomic } from '../infra/fs.js';
import { matchesAny } from '../domain/globs.js';
import type { BrainStore } from '../brain/store.js';
import { CLI_INVOCATION } from '../brain/paths.js';

/** Escalades, décisions (ADR), chartes d'équipe, détection de conflits. */

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

export interface EscalationInput {
  taskId: string;
  problem: string;
  context: string;
  tried: string;
  results: string;
  hypotheses: string;
  decisionNeeded: string;
}

/** ESCALATE_TO_OPUS : un dossier minimal et autonome — Opus résout ce problème-là, pas tout le projet. */
export function openEscalation(store: BrainStore, input: EscalationInput): string {
  const task = store.task(input.taskId);
  const id = nextId('E', store.listDir(store.paths.escalations).map((f) => f.split('-').slice(0, 2).join('-')));
  const file = path.join(store.paths.escalations, `${id}-${task.id}.md`);
  writeTextAtomic(file, [
    `# ${id} — ESCALATE_TO_OPUS — ${task.id} ${task.title}`,
    '',
    'status: open',
    `opened: ${new Date().toISOString()}`,
    `task: ${task.id} (${task.kind}, tentatives : ${task.attempts.length})`,
    '',
    '## Problème', input.problem, '',
    '## Contexte minimal', input.context, '',
    '## Tentatives effectuées', input.tried, '',
    '## Résultats observés', input.results, '',
    '## Hypothèses', input.hypotheses, '',
    '## Décision attendue', input.decisionNeeded, '',
    '## Décision (rempli par ceng-principal)', '_en attente_', '',
  ].join('\n'));
  store.log({ type: 'escalation.opened', taskId: task.id, data: { id, problem: input.problem.slice(0, 200) } });
  return store.paths.rel(file);
}

export function resolveEscalation(store: BrainStore, id: string, decision: string): string {
  const name = store.listDir(store.paths.escalations).find((f) => f.startsWith(`${id.toUpperCase()}-`));
  if (!name) throw new Error(`Escalade ${id} introuvable.`);
  const file = path.join(store.paths.escalations, name);
  const text = readText(file) ?? '';
  writeTextAtomic(file, text.replace('status: open', `status: resolved\nresolved: ${new Date().toISOString()}`).replace('_en attente_', decision));
  const taskId = name.split('-').slice(2).join('-').replace(/\.md$/, '');
  store.log({ type: 'escalation.resolved', taskId, data: { id: id.toUpperCase() } });
  return store.paths.rel(file);
}

export interface DecisionInput {
  title: string;
  context: string;
  decision: string;
  consequences: string;
  alternatives?: string;
  taskId?: string;
}

export function recordDecision(store: BrainStore, input: DecisionInput): string {
  const existing = store.listDir(store.paths.decisions).map((f) => f.split('-').slice(0, 2).join('-'));
  const id = nextId('ADR', existing);
  const file = path.join(store.paths.decisions, `${id}-${slug(input.title)}.md`);
  writeTextAtomic(file, [
    `# ${id} — ${input.title}`,
    '',
    `date: ${new Date().toISOString().slice(0, 10)} · statut : acceptée${input.taskId ? ` · tâche : ${input.taskId}` : ''}`,
    '',
    '## Contexte', input.context, '',
    '## Décision', input.decision, '',
    '## Conséquences', input.consequences, '',
    ...(input.alternatives ? ['## Alternatives écartées', input.alternatives, ''] : []),
  ].join('\n'));
  store.log({ type: 'decision.recorded', ...(input.taskId ? { taskId: input.taskId } : {}), data: { id, title: input.title } });
  return store.paths.rel(file);
}

/** Charte d'équipe (Agent Teams) : persistée dans le Brain, car la mailbox de l'équipe ne survit pas à la session. */
export function writeTeamCharter(store: BrainStore, tasks: readonly Task[], mission: string): string {
  const id = nextId('TEAM', store.listDir(store.paths.teams).map((f) => f.replace(/\.md$/, '')));
  const file = path.join(store.paths.teams, `${id}.md`);
  const members = tasks.map((t) => {
    const r = t.route;
    return [
      `### ${t.id} — ${t.title}`,
      `- Teammate : ${r?.implementer.agent ?? 'ceng-builder'} · modèle ${r?.implementer.model ?? 'sonnet'}`,
      `- Fichiers autorisés (exclusifs) : ${t.files.join(', ') || '⚠ non déclarés'}`,
      `- Contrats partagés : ${t.interfaces.join(', ') || 'aucun'}`,
      `- Critères de succès : ${t.acceptance.join(' ; ') || 'voir tâche'}`,
      `- Livrable : code + tests + rapport .ceng/brain/reports/${t.id}.md`,
    ].join('\n');
  });
  writeTextAtomic(file, [
    `# ${id} — Charte d'équipe`,
    '',
    `créée : ${new Date().toISOString()}`,
    '',
    '## Mission', mission, '',
    '## Membres et périmètres', ...members, '',
    '## Limites',
    '- Chaque teammate ne modifie que ses fichiers autorisés. Besoin d\'un autre fichier → message au propriétaire, pas d\'édition.',
    '- Aucune action « approbation humaine » (déploiement, données, infra, secrets, licences).',
    '- Pas de nouvelle dépendance sans justification dans le rapport.',
    '',
    '## Communication (budget)',
    '- Envoyer un message seulement s\'il change le travail d\'un autre agent : contrat modifié, blocage, conflit, décision, résultat de test qui le concerne, risque.',
    '- Format : `[TÂCHE] type: décision|blocage|contrat|risque — fait — action attendue` (3 lignes max).',
    '- Pas de compte rendu de progression au lead : le statut vit dans la task list et le rapport final.',
    '',
    '## Validation',
    `- Chaque teammate : tests de son périmètre verts, \`${CLI_INVOCATION} gate run <tâche>\`, rapport écrit.`,
    '- Lead : intégration → détection de conflits (`ceng conflicts`) → revue ciblée → gates globales.',
    '',
  ].join('\n'));
  store.log({ type: 'team.chartered', data: { id, tasks: tasks.map((t) => t.id) } });
  return store.paths.rel(file);
}

export interface Conflict {
  file: string;
  agents: string[];
  outOfScope: { agent: string; task?: string }[];
}

/**
 * Détecte (a) un même fichier modifié par plusieurs agents dans la fenêtre, (b) des éditions
 * hors du périmètre déclaré de la tâche. Source : événements `file.edited` du hook PostToolUse.
 */
export function detectConflicts(store: BrainStore, sinceIso?: string): Conflict[] {
  const since = sinceIso ?? store.state().lastCheckpoint?.at ?? '1970-01-01';
  const edits = store.events().filter((e) => e.type === 'file.edited' && e.ts >= since && e.agentId);
  const tasks = store.tasks();
  const byFile = new Map<string, Set<string>>();
  for (const e of edits) {
    const f = String(e.data?.['file'] ?? '');
    if (!f) continue;
    byFile.set(f, (byFile.get(f) ?? new Set()).add(e.agentId!));
  }
  const conflicts: Conflict[] = [];
  for (const [file, agents] of byFile) {
    const outOfScope = edits
      .filter((e) => e.data?.['file'] === file && e.taskId)
      .filter((e) => {
        const t = tasks.find((x) => x.id === e.taskId);
        return t && t.files.length > 0 && !matchesAny(file, t.files);
      })
      .map((e) => ({ agent: e.agentId!, ...(e.taskId ? { task: e.taskId } : {}) }));
    if (agents.size > 1 || outOfScope.length > 0) conflicts.push({ file, agents: [...agents], outOfScope });
  }
  for (const c of conflicts) store.log({ type: 'conflict.detected', data: { file: c.file, agents: c.agents, outOfScope: c.outOfScope.length } });
  return conflicts;
}
