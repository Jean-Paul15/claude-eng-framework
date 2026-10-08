import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sleepSync } from './sleep.js';

export function exists(p: string): boolean {
  return fs.existsSync(p);
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readText(p: string): string | undefined {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return undefined;
  }
}

export function readJson<T>(p: string): T | undefined {
  const text = readText(p);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(`JSON invalide dans ${p} : ${(err as Error).message}`);
  }
}

/** Opérations système injectables (tests : simuler un fichier verrouillé sans dépendre de Windows). */
export interface RenameOps {
  rename: (from: string, to: string) => void;
  sleep: (ms: number) => void;
}

const REAL_OPS: RenameOps = { rename: (from, to) => fs.renameSync(from, to), sleep: sleepSync };

/** Erreurs transitoires typiques de Windows (antivirus, indexeur, lecteur concurrent) : un court délai suffit souvent. */
const TRANSIENT_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'UNKNOWN']);
export const RENAME_ATTEMPTS = 10;

export function isTransientFsError(err: unknown): boolean {
  return TRANSIENT_CODES.has((err as NodeJS.ErrnoException).code ?? '');
}

/** `rename` avec réessais (délai croissant, borné) sur les erreurs transitoires ; les autres erreurs remontent aussitôt. */
export function renameWithRetry(from: string, to: string, ops: RenameOps = REAL_OPS): void {
  let delay = 15;
  for (let attempt = 1; ; attempt++) {
    try {
      ops.rename(from, to);
      return;
    } catch (err) {
      if (!isTransientFsError(err) || attempt >= RENAME_ATTEMPTS) throw err;
      ops.sleep(delay);
      delay = Math.min(delay * 2, 250);
    }
  }
}

/**
 * Écriture atomique : fichier temporaire + rename (avec réessais sous Windows). Jamais de copie de repli, qui n'est pas
 * atomique et échoue de la même façon sur une cible verrouillée. En cas d'échec, le temporaire est supprimé :
 * aucun .tmp orphelin ne reste dans le dépôt, et l'ancien contenu de la cible est intact.
 */
export function writeTextAtomic(p: string, content: string, ops: RenameOps = REAL_OPS): void {
  ensureDir(path.dirname(p));
  const tmp = `${p}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    renameWithRetry(tmp, p, ops);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true, maxRetries: 3 });
    } catch {
      // nettoyage au mieux : l'erreur d'origine est plus utile que celle du nettoyage
    }
    const code = (err as NodeJS.ErrnoException).code;
    throw new Error(`Écriture de ${path.basename(p)} impossible${code ? ` (${code})` : ''} : ${(err as Error).message}. Le fichier est peut-être verrouillé par un autre programme (éditeur, antivirus) : réessayer.`);
  }
}

const ORPHAN_TMP = /\.\d+\.[0-9a-f]{8}\.tmp$/;
const ORPHAN_MIN_AGE_MS = 10 * 60_000;

/** Supprime les temporaires d'écriture atomique abandonnés (crash, verrou) d'un dossier. Renvoie les noms supprimés. */
export function removeOrphanTemps(dir: string, minAgeMs = ORPHAN_MIN_AGE_MS): string[] {
  const removed: string[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (!ORPHAN_TMP.test(name)) continue;
    const file = path.join(dir, name);
    try {
      if (Date.now() - fs.statSync(file).mtimeMs < minAgeMs) continue;
      fs.rmSync(file, { force: true });
      removed.push(name);
    } catch {
      // verrouillé ou déjà parti : on réessaiera au prochain démarrage
    }
  }
  return removed;
}

export function writeJsonAtomic(p: string, value: unknown): void {
  writeTextAtomic(p, `${JSON.stringify(value, null, 2)}\n`);
}

export function appendLine(p: string, line: string): void {
  ensureDir(path.dirname(p));
  fs.appendFileSync(p, `${line}\n`, 'utf8');
}

export function readJsonLines<T>(p: string): T[] {
  const text = readText(p);
  if (!text) return [];
  const out: T[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // ligne corrompue (écriture interrompue) : ignorée plutôt que de casser toute la lecture
    }
  }
  return out;
}

/** Dernières lignes JSON d'un journal volumineux : ne lit que les `maxBytes` finaux (la première ligne, tronquée, est ignorée). */
export function readJsonLinesTail<T>(p: string, maxBytes = 1_000_000): T[] {
  let fd: number | undefined;
  try {
    fd = fs.openSync(p, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split(/\r?\n/);
    if (size > length) lines.shift();
    const out: T[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as T);
      } catch {
        // ligne corrompue : ignorée
      }
    }
    return out;
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function copyDir(src: string, dst: string, filter?: (rel: string) => boolean): string[] {
  const copied: string[] = [];
  const walk = (rel: string) => {
    const from = path.join(src, rel);
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (filter && !filter(childRel)) continue;
      if (entry.isDirectory()) walk(childRel);
      else if (entry.isFile()) {
        const to = path.join(dst, childRel);
        ensureDir(path.dirname(to));
        fs.copyFileSync(path.join(src, childRel), to);
        copied.push(childRel);
      }
    }
  };
  walk('');
  return copied;
}

export const DEFAULT_IGNORES = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.turbo', 'coverage',
  'target', 'vendor', '.venv', 'venv', 'env', '__pycache__', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  '.dart_tool', '.gradle', '.idea', '.vscode', 'Pods', '.terraform', '.ceng', '.cache', 'bin', 'obj',
]);

export interface WalkOptions {
  maxFiles?: number;
  maxDepth?: number;
  ignore?: Set<string>;
}

/**
 * Chemins (relatifs POSIX) jamais parcourus : copies de travail des agents (worktrees de Claude Code), qui
 * dupliquent tout le dépôt et rempliraient le plafond de fichiers avant le vrai code.
 */
export const DEFAULT_IGNORED_PATHS = new Set(['.claude/worktrees', 'graphify-out']);

/**
 * Liste les fichiers (chemins relatifs POSIX) en ignorant les répertoires lourds/générés. Parcours PAR NIVEAUX : les
 * fichiers proches de la racine (manifestes d'une application dans `app/`, `site/`…) sont toujours vus, même quand un
 * dossier profond atteint le plafond de fichiers.
 */
export function listFiles(root: string, opts: WalkOptions = {}): { files: string[]; truncated: boolean } {
  const maxFiles = opts.maxFiles ?? 20000;
  const maxDepth = opts.maxDepth ?? 8;
  const ignore = opts.ignore ?? DEFAULT_IGNORES;
  const files: string[] = [];
  let truncated = false;
  let level = [''];
  for (let depth = 0; depth <= maxDepth && level.length > 0 && !truncated; depth++) {
    const next: string[] = [];
    for (const rel of level) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (!ignore.has(e.name) && !DEFAULT_IGNORED_PATHS.has(childRel)) next.push(childRel);
        } else if (e.isFile()) {
          if (files.length >= maxFiles) {
            truncated = true;
            break;
          }
          files.push(childRel);
        }
      }
      if (truncated) break;
    }
    level = next;
  }
  return { files, truncated };
}

