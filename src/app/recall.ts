import { expandTerms, scoreWords, tokenize } from '../domain/similarity.js';
import { exists, readText } from '../infra/fs.js';
import { featureLabel, listFeatures, type Feature } from './features.js';
import { listDecisions } from './decisions.js';
import type { BrainStore } from '../brain/store.js';

/**
 * Rappel de l'existant : ce qui, dans la mémoire du projet (fonctionnalités, tâches, décisions, réponses de l'humain),
 * ressemble à une demande. Fichiers JSON et titres seulement (jamais de parcours du code : trop lent pour un hook) ;
 * le code reste l'affaire de `ceng similar`.
 */

export type RecallKind = 'feature' | 'task' | 'decision' | 'answer';

export interface RecallHit {
  kind: RecallKind;
  id: string;
  line: string;
  score: number;
  /** Fonctionnalité écartée ou remplacée : à rappeler en premier, c'est là que l'oubli coûte le plus. */
  dead?: boolean;
  feature?: Feature;
}

export const RECALL_MIN_SCORE = 3;

export function recall(store: BrainStore, query: string, limit = 5): RecallHit[] {
  const terms = expandTerms(query);
  if (!terms.exact.size) return [];
  const hits: RecallHit[] = [];
  for (const f of listFeatures(store)) {
    const score = scoreWords(tokenize(`${f.name} ${f.summary} ${f.keywords.join(' ')}`), terms);
    if (score >= RECALL_MIN_SCORE) {
      const dead = f.status === 'rejected' || f.status === 'replaced';
      hits.push({ kind: 'feature', id: f.id, score: score + (dead ? 100 : 0), dead, feature: f, line: `${f.id} « ${f.name} » — ${featureLabel(f.status)}${f.reason ? ` (${f.reason})` : ''}${f.tasks.length ? ` · ${f.tasks.slice(0, 3).join(', ')}` : ''}${f.files.length ? ` · ${f.files.slice(0, 2).join(', ')}` : ''}` });
    }
  }
  for (const t of store.tasks().filter((x) => x.status !== 'cancelled')) {
    const score = scoreWords(tokenize(t.title), terms);
    if (score >= RECALL_MIN_SCORE) hits.push({ kind: 'task', id: t.id, score, line: `${t.id} « ${t.title} » — ${t.status === 'done' ? 'terminée' : t.status}` });
  }
  for (const d of listDecisions(store)) {
    const score = scoreWords(tokenize(d.title), terms);
    if (score >= RECALL_MIN_SCORE) hits.push({ kind: 'decision', id: d.file, score, line: `Décision « ${d.title} »${d.status ? ` (${d.status})` : ''}` });
  }
  const answers = `${store.paths.brain}/answers.md`;
  if (exists(answers)) {
    for (const l of (readText(answers) ?? '').split(/\r?\n/).filter((x) => x.startsWith('- '))) {
      const score = scoreWords(tokenize(l), terms);
      if (score >= RECALL_MIN_SCORE) hits.push({ kind: 'answer', id: 'answers.md', score, line: `Réponse déjà donnée : ${l.slice(2, 200)}` });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Texte injecté avant que Claude réponde ; vide quand rien ne ressemble. */
export function renderRecall(hits: readonly RecallHit[]): string {
  if (!hits.length) return '';
  const rejected = hits.some((h) => h.dead);
  return [
    '[ceng] Avant de créer quoi que ce soit, proche de cette demande :',
    ...hits.map((h) => `- ${h.line}`),
    rejected ? 'Une idée écartée ne se rouvre qu\'en le disant à l\'humain.' : 'Étendre ou corriger l\'existant ; pas de seconde version.',
  ].join('\n').slice(0, 900);
}
