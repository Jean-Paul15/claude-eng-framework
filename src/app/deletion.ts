import * as path from 'node:path';
import { isRegenerablePath } from '../domain/guardrails.js';
import { normalizePath } from '../domain/globs.js';
import { exists } from '../infra/fs.js';
import { Git } from '../infra/git.js';
import type { BrainStore } from '../brain/store.js';
import { createCheckpoint } from './checkpoints.js';

/**
 * Suppressions sans frein mais jamais irréversibles : si un instantané git peut capturer tout ce qui va être
 * supprimé, on le prend et la suppression passe sans demander l'humain (annulable par `ceng rollback`).
 * Sinon (hors projet, fichiers ignorés par git comme .env, fichiers du framework, cibles non résolues),
 * l'humain décide.
 */

/** Chemins jamais supprimés automatiquement : mémoire, runtime et gouvernance du framework, internes git. */
const PROTECTED_PREFIXES = ['.git', '.ceng/brain', '.ceng/runtime', '.ceng/config.json', '.claude', 'CLAUDE.md'];

export type DeletionCheck = { ok: true; checkpointId: string } | { ok: false; reason: string };

export function autoApproveDeletion(store: BrainStore, targets: readonly string[], cwd?: string): DeletionCheck {
  const root = store.paths.root;
  const git = new Git(root);
  if (!git.isRepo()) return { ok: false, reason: 'projet sans dépôt git : la suppression ne pourrait pas être annulée' };
  const base = cwd ? path.resolve(cwd) : root;
  const rels: string[] = [];
  for (const raw of targets) {
    if (/[$`*?{}]/.test(raw)) return { ok: false, reason: `cible non résolue (variable ou joker) : ${raw}` };
    const abs = path.resolve(base, raw.replace(/^~(?=$|[\\/])/, '__home__'));
    const rel = normalizePath(path.relative(root, abs));
    if (raw.startsWith('~') || rel === '' || rel === '.' || rel.startsWith('..') || path.isAbsolute(rel)) {
      return { ok: false, reason: `hors du projet ou racine du projet : ${raw}` };
    }
    if (PROTECTED_PREFIXES.some((p) => rel === p || rel.startsWith(`${p}/`))) return { ok: false, reason: `fichier du framework ou de gouvernance : ${rel}` };
    rels.push(rel);
  }
  for (const rel of rels) {
    if (!exists(path.join(root, rel))) continue;
    const ignored = git.ignoredFiles(rel).filter((f) => !isRegenerablePath(f));
    if (ignored.length) {
      return { ok: false, reason: `contient des fichiers ignorés par git, non sauvegardables (${ignored.slice(0, 3).join(', ')}${ignored.length > 3 ? '…' : ''})` };
    }
  }
  const state = store.state();
  const cp = createCheckpoint(store, {
    ...(state.currentTask ? { taskId: state.currentTask } : {}),
    done: `Instantané automatique avant suppression : ${rels.join(', ')}`.slice(0, 300),
    next: state.lastCheckpoint?.next ?? 'continuer la tâche en cours',
    auto: true,
  });
  if (!cp.snapshot) return { ok: false, reason: 'instantané git impossible' };
  return { ok: true, checkpointId: cp.id };
}
