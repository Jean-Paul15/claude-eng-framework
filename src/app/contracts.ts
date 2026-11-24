import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { normalizePath } from '../domain/globs.js';
import { exists, readJson, writeJsonAtomic } from '../infra/fs.js';
import * as fs from 'node:fs';
import type { BrainStore } from '../brain/store.js';
import type { Task } from '../domain/types.js';
import { matchesAny } from '../domain/globs.js';

/**
 * Contrats gelés : schéma de base, contrat d'API, types partagés, tokens de design. Tant qu'un contrat est gelé, un sous-agent
 * ne le modifie pas (il décrit le changement dans son rapport) ; l'orchestrateur le change par `ceng contract bump`, qui dit
 * quelles tâches en cours sont touchées. Deux agents qui « ajustent juste un peu » le contrat divergent : c'est ce qu'on évite.
 */

export interface FrozenContract {
  file: string;
  sha256: string;
  version: number;
  frozenAt: string;
}

const registry = (store: BrainStore) => path.join(store.paths.brain, 'contracts.json');
export const listContracts = (store: BrainStore): FrozenContract[] => readJson<FrozenContract[]>(registry(store)) ?? [];

const hashOf = (root: string, file: string): string => createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');

export function freezeContracts(store: BrainStore, files: readonly string[]): FrozenContract[] {
  const root = store.paths.root;
  const known = listContracts(store);
  const added: FrozenContract[] = [];
  for (const raw of files) {
    const file = normalizePath(raw);
    if (!exists(path.join(root, file))) throw new Error(`Contrat introuvable : ${file}`);
    if (known.some((c) => c.file === file)) continue;
    added.push({ file, sha256: hashOf(root, file), version: 1, frozenAt: new Date().toISOString() });
  }
  writeJsonAtomic(registry(store), [...known, ...added]);
  return added;
}

export const isFrozen = (store: BrainStore, rel: string): boolean => listContracts(store).some((c) => c.file === normalizePath(rel));

/** Contrats dont le fichier a changé sans `bump` (ou a disparu). */
export function contractDrift(store: BrainStore): FrozenContract[] {
  return listContracts(store).filter((c) => !exists(path.join(store.paths.root, c.file)) || hashOf(store.paths.root, c.file) !== c.sha256);
}

/** Change d'un contrat : nouvelle empreinte, version suivante ; renvoie les tâches en cours dont les fichiers ou contrats le touchent. */
export function bumpContract(store: BrainStore, rawFile: string): { contract: FrozenContract; concerned: Task[] } {
  const file = normalizePath(rawFile);
  const all = listContracts(store);
  const c = all.find((x) => x.file === file);
  if (!c) throw new Error(`${file} n'est pas un contrat gelé (\`ceng contract list\`).`);
  const next: FrozenContract = { ...c, sha256: hashOf(store.paths.root, file), version: c.version + 1 };
  writeJsonAtomic(registry(store), all.map((x) => (x.file === file ? next : x)));
  const concerned = store.tasks().filter((t) => t.status === 'in_progress' && (matchesAny(file, t.files) || t.interfaces.some((i) => file.includes(i.replace(/^[a-z]+:/, '').replace(/^\//, '')))));
  return { contract: next, concerned };
}
