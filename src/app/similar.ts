import * as fs from 'node:fs';
import * as path from 'node:path';
import { expandTerms, extractSymbols, scoreFile, type Candidate } from '../domain/similarity.js';
import { listFiles } from '../infra/fs.js';

/** Extensions de code et de schéma parcourues (le reste — images, binaires, verrous — n'a pas de logique à réutiliser). */
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|astro|py|rb|go|rs|java|kt|kts|swift|dart|php|cs|sql|prisma|graphql|gql)$/i;
const SKIP = /(^|\/)(node_modules|dist|build|out|coverage|\.next|\.nuxt|\.dart_tool|\.ceng|vendor|__generated__|generated)(\/|$)|\.(min|d)\.[jt]s$|\.(test|spec)\.|_test\.|\.g\.dart$|\.freezed\.dart$/;
const MAX_BYTES = 256 * 1024;

export interface SimilarOptions {
  limit?: number;
  /** Fichiers à exclure (ceux que la tâche va créer ou modifier elle-même). */
  exclude?: (file: string) => boolean;
}

/**
 * Existant proche d'une demande : fichiers dont le chemin ou les symboles déclarés parlent de la même chose.
 * Une lecture par fichier, plafonnée en taille ; aucune dépendance (graphify complète pour les dépendances croisées).
 */
export function findSimilar(root: string, query: string, opts: SimilarOptions = {}): Candidate[] {
  const terms = expandTerms(query);
  if (terms.exact.size === 0) return [];
  const { files } = listFiles(root, { maxFiles: 20000 });
  const out: Candidate[] = [];
  for (const file of files) {
    if (!CODE_EXT.test(file) || SKIP.test(file) || opts.exclude?.(file)) continue;
    let content = '';
    try {
      const abs = path.join(root, file);
      if (fs.statSync(abs).size > MAX_BYTES) continue;
      content = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const c = scoreFile(file, extractSymbols(content), terms);
    if (c.score >= 3) out.push(c);
  }
  return out.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file)).slice(0, opts.limit ?? 10);
}
