import * as path from 'node:path';
import { relevantDecisions } from '../../app/decisions.js';
import { findSimilar } from '../../app/similar.js';
import { routeAndStore } from '../../app/tasks.js';
import { BrainStore } from '../../brain/store.js';
import { matchesAny, normalizePath } from '../../domain/globs.js';
import type { Candidate } from '../../domain/similarity.js';
import { DIAGRAM_LABEL, requiredDiagrams } from '../../domain/diagrams.js';
import type { Task } from '../../domain/types.js';
import { exists, listFiles } from '../../infra/fs.js';
import { out, parse, requirePositional, str, UsageError } from '../args.js';

function storeFor(dir?: string): BrainStore {
  const store = new BrainStore(path.resolve(dir ?? process.cwd()));
  store.requireInitialized();
  return store;
}

function candidateLine(c: Candidate): string {
  const syms = c.symbols.map((s) => `${s.name}:${s.line}`).join(', ');
  return `  - ${c.file}${syms ? `  (${syms})` : ''}`;
}

/**
 * `ceng similar <termes…>` — l'existant proche d'une demande (chemins et symboles déclarés, synonymes FR/EN), AVANT de créer :
 * étendre ou factoriser ce qui existe plutôt que dupliquer une fonctionnalité.
 */
export function similarCommand(argv: string[]): void {
  const p = parse(argv, { dir: { type: 'string' }, limit: { type: 'string' } });
  const root = path.resolve(str(p, 'dir') ?? process.cwd());
  const query = p.positionals.join(' ').trim();
  if (!query) throw new UsageError('Usage : ceng similar <termes de la demande…> [--limit 10]');
  const found = findSimilar(root, query, { limit: Number(str(p, 'limit') ?? '10') || 10 });
  out(p, found.length
    ? [`Existant proche de « ${query} » — lire ces fichiers (portions indiquées) et étendre/factoriser avant de créer :`, ...found.map(candidateLine)].join('\n')
    : `Rien de proche de « ${query} » dans le code (vérifier aussi avec graphify query si le graphe existe) : création justifiée.`, found);
}

/** Fichiers existants couverts par les globs de la tâche (ce qu'elle a le droit de modifier). */
function filesInScope(root: string, globs: readonly string[]): string[] {
  if (!globs.length) return [];
  return listFiles(root, { maxFiles: 20000 }).files.filter((f) => matchesAny(f, [...globs])).slice(0, 40);
}

function depReports(store: BrainStore, task: Task): string[] {
  return task.deps.filter((d) => exists(store.paths.report(d))).map((d) => `  - .ceng/brain/reports/${d}.md`);
}

/**
 * `ceng brief <id> [--ref fichier]…` — paquet de délégation minimal : ce que le worker doit toucher, lire et respecter, et rien d'autre.
 * L'orchestrateur le colle tel quel dans l'outil Agent (il peut compléter « Contexte minimal ») : le worker ne refait pas
 * l'exploration, ne relit pas tout le dépôt, et réutilise l'existant au lieu de le dupliquer.
 */
export function briefCommand(argv: string[]): void {
  const p = parse(argv, { dir: { type: 'string' }, ref: { type: 'string', multiple: true }, context: { type: 'string' } });
  const store = storeFor(str(p, 'dir'));
  const root = store.paths.root;
  const task = routeAndStore(store, requirePositional(p, 0, 'tâche'));
  const route = task.route!;
  const refs = ((p.values['ref'] as string[] | undefined) ?? []).map(normalizePath);
  const missing = refs.filter((r) => !exists(path.resolve(root, r)));
  if (missing.length) throw new UsageError(`Référence introuvable : ${missing.join(', ')}`);
  const scope = filesInScope(root, task.files);
  const similar = findSimilar(root, `${task.title} ${task.domains.join(' ')}`, {
    limit: 6,
    exclude: (f) => (task.files.length > 0 && matchesAny(f, [...task.files])) || refs.includes(f),
  });
  const decisions = relevantDecisions(store, task).map((d) => `  - .ceng/brain/decisions/${d.file} — ${d.title}${d.status ? ` (${d.status})` : ''}`);
  const reports = depReports(store, task);
  const section = (title: string, lines: string[]) => (lines.length ? [title, ...lines] : []);
  const text = [
    `Tâche ${task.id} — ${task.title}`,
    `Objectif : ${task.acceptance[0] ?? task.title}`,
    `Contexte minimal : ${str(p, 'context') ?? '<ce que le worker ne peut pas trouver seul — 2 à 5 lignes>'}`,
    `Périmètre (seuls fichiers modifiables) : ${task.files.length ? task.files.join(', ') : '<à préciser : --files sur la tâche>'}`,
    ...section('Fichiers existants dans le périmètre (lire seulement ce qui est modifié) :', scope.map((f) => `  - ${f}`)),
    ...section('Références à reprendre et adapter (copier la logique éprouvée, ne pas réécrire de zéro) :', refs.map((r) => `  - ${r}`)),
    ...section('Existant proche à RÉUTILISER ou étendre (vérifier avant de créer quoi que ce soit) :', similar.map(candidateLine)),
    ...section('Décisions en vigueur (lire celles qui concernent la tâche) :', decisions),
    ...section('Rapports des dépendances :', reports),
    'Critères d\'acceptation :',
    ...(task.acceptance.length ? task.acceptance.map((a) => `  - ${a}`) : ['  - <critères vérifiables>']),
    `Tests : ${route.testStrategy.flow}${route.testStrategy.types.length ? ` [${route.testStrategy.types.join(', ')}]` : ''}${route.testStrategy.testFirst ? ' — test d\'abord (TDD)' : ''}`,
    ...(task.domains.includes('frontend') || task.kind === 'ui' || task.kind === 'design' ? [`Validation visuelle : parcours capturé et relu image par image (skill visual-flow-testing), mobile + tablette + desktop. Captures à écrire dans .ceng/shots/${task.id}/.`] : []),
    ...section('Diagrammes obligatoires (Mermaid, créés ou mis à jour dans cette tâche — gate `diagrams`) :', requiredDiagrams(task).map((d) => `  - ${DIAGRAM_LABEL[d.kind]} — ${d.why}`)),
    'Règles de contexte : ne lis que les fichiers listés et ceux qu\'ils importent directement ; pas d\'exploration large. S\'il manque une information, arrête-toi et remonte-la (status: blocked) plutôt que de deviner ou de parcourir le dépôt.',
    `Livrable : code + tests + .ceng/brain/reports/${task.id}.md + bloc CENG_REPORT (dont « reuse: » = ce qui a été réutilisé ou pourquoi rien ne l'était ; « removed: » = ancien code, doublons ou code mort supprimés).`,
    `Agent : ${route.implementer.agent} · modèle ${route.implementer.model} · effort ${route.implementer.effort}`,
  ].join('\n');
  out(p, text, { task: task.id, files: scope, refs, similar, decisions, route: route.implementer });
}
