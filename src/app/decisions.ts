import * as fs from 'node:fs';
import * as path from 'node:path';
import { expandTerms, scoreWords, tokenize } from '../domain/similarity.js';
import type { Task } from '../domain/types.js';
import { exists, readText } from '../infra/fs.js';
import type { BrainStore } from '../brain/store.js';

/** Décisions (ADR) du Project Brain : lecture, filtrage des décisions mortes, sélection des plus pertinentes pour une tâche. */

export interface Decision {
  file: string;
  title: string;
  status: string;
  text: string;
}

const DEAD = /remplac|rejet|superseded|rejected/i;
const STRUCTURING = /architecture|\bpile\b|\bstack\b|schéma|schema|direction créative/i;

/** Décisions en vigueur (ni remplacées ni rejetées), triées par nom de fichier. */
export function listDecisions(store: BrainStore): Decision[] {
  const dir = store.paths.decisions;
  if (!exists(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((file) => {
      const text = readText(path.join(dir, file)) ?? '';
      return { file, title: /^#\s+(.+)$/m.exec(text)?.[1] ?? file, status: /statut\s*:\s*\**\s*([a-zé]+)/i.exec(text)?.[1] ?? '', text };
    })
    .filter((d) => !DEAD.test(d.status));
}

/** Fin de vie d'une décision : remplacée par une autre, ou rejetée. L'ADR reste lisible ; les briefs et le rappel l'ignorent. */
export function endDecision(store: BrainStore, id: string, kind: 'supersede' | 'reject', reason: string, by?: string): string {
  const dir = store.paths.decisions;
  const file = exists(dir) ? fs.readdirSync(dir).find((f) => f.startsWith(`${id.toUpperCase()}-`) || f === id) : undefined;
  if (!file) throw new Error(`Décision ${id} introuvable (ADR-xxxx, voir .ceng/brain/decisions/).`);
  if (kind === 'supersede' && !by) throw new Error('--by <ADR> obligatoire : la décision qui la remplace.');
  if (!reason.trim()) throw new Error('--reason obligatoire : pourquoi.');
  const abs = path.join(dir, file);
  const text = readText(abs) ?? '';
  const label = kind === 'supersede' ? `remplacée (par ${by!.toUpperCase()})` : 'rejetée';
  const next = text.replace(/(statut\s*:\s*)[^·\n]+/i, `$1${label} `);
  fs.writeFileSync(abs, `${next.trimEnd()}\n\n## Fin de vie\n${new Date().toISOString().slice(0, 10)} · ${label} : ${reason.trim()}\n`);
  store.log({ type: 'decision.recorded', data: { id: file.split('-').slice(0, 2).join('-'), ended: kind, by: by ?? null } });
  return store.paths.rel(abs);
}

/**
 * Les `limit` décisions les plus utiles à la tâche : celles dont le texte ressemble à son titre, ses domaines et ses
 * fichiers, complétées par les décisions structurantes (pile, schéma, direction créative) — jamais « les 12 dernières »,
 * qui font sortir des paquets de délégation les décisions les plus anciennes, donc les plus fondatrices.
 */
export function relevantDecisions(store: BrainStore, task: Pick<Task, 'title' | 'domains' | 'files'>, limit = 8): Decision[] {
  const all = listDecisions(store);
  if (all.length <= limit) return all;
  const terms = expandTerms(`${task.title} ${task.domains.join(' ')} ${task.files.join(' ')}`);
  const ranked = all
    .map((d) => ({ d, score: scoreWords(tokenize(`${d.title} ${d.text.slice(0, 1500)}`), terms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.d);
  const chosen = new Set(ranked.slice(0, limit));
  for (const d of all) if (chosen.size < limit && STRUCTURING.test(`${d.title}\n${d.text.slice(0, 600)}`)) chosen.add(d);
  return all.filter((d) => chosen.has(d));
}
