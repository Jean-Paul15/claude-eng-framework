import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

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

/** Écriture atomique (fichier temporaire + rename) : un crash ne laisse jamais un état à moitié écrit. */
export function writeTextAtomic(p: string, content: string): void {
  ensureDir(path.dirname(p));
  const tmp = `${p}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, p);
  } catch (err) {
    // Windows : rename peut échouer si la cible est verrouillée par un lecteur ; repli copie + suppression.
    fs.copyFileSync(tmp, p);
    fs.rmSync(tmp, { force: true });
    if (!exists(p)) throw err;
  }
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

/** Liste les fichiers (chemins relatifs POSIX) en ignorant les répertoires lourds/générés. */
export function listFiles(root: string, opts: WalkOptions = {}): { files: string[]; truncated: boolean } {
  const maxFiles = opts.maxFiles ?? 20000;
  const maxDepth = opts.maxDepth ?? 8;
  const ignore = opts.ignore ?? DEFAULT_IGNORES;
  const files: string[] = [];
  let truncated = false;
  const walk = (rel: string, depth: number) => {
    if (truncated || depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!ignore.has(e.name)) walk(childRel, depth + 1);
      } else if (e.isFile()) {
        files.push(childRel);
      }
    }
  };
  walk('', 0);
  return { files, truncated };
}
