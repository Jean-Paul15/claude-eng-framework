import * as path from 'node:path';
import { listFiles, readText } from '../infra/fs.js';

/**
 * Vue en lecture seule du projet, partagée par tous les détecteurs.
 * Les détecteurs ne touchent jamais le système de fichiers directement : ils sont testables
 * avec un contexte construit en mémoire.
 */
export interface ScanContext {
  files: string[];
  has(rel: string): boolean;
  read(rel: string): string | undefined;
  /** Fichiers dont le nom (basename) correspond. */
  byName(name: string | RegExp): string[];
  /** Dépendances déclarées, tous écosystèmes confondus (noms en minuscules). */
  deps: Set<string>;
  /** Versions déclarées quand elles sont lisibles (ex. "next" → "15.1.0"). */
  versions: Record<string, string>;
  packageJson?: PackageJson;
  truncated: boolean;
}

export interface PackageJson {
  name?: string;
  license?: string;
  private?: boolean;
  bin?: unknown;
  main?: string;
  exports?: unknown;
  workspaces?: string[] | { packages?: string[] };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const MANIFEST_DEPTH = 3;

function depth(rel: string): number {
  return rel.split('/').length - 1;
}

export function buildScanContext(root: string): ScanContext {
  const { files, truncated } = listFiles(root);
  return createScanContext(files, (rel) => readText(path.join(root, rel)), truncated);
}

export function createScanContext(files: string[], reader: (rel: string) => string | undefined, truncated = false): ScanContext {
  const fileSet = new Set(files);
  const cache = new Map<string, string | undefined>();
  const read = (rel: string) => {
    if (!cache.has(rel)) cache.set(rel, fileSet.has(rel) ? reader(rel) : undefined);
    return cache.get(rel);
  };
  const byName = (name: string | RegExp) =>
    files.filter((f) => {
      const base = f.slice(f.lastIndexOf('/') + 1);
      return typeof name === 'string' ? base === name : name.test(base);
    });

  const deps = new Set<string>();
  const versions: Record<string, string> = {};
  const addDep = (name: string, version?: string) => {
    const n = name.trim().toLowerCase();
    if (!n) return;
    deps.add(n);
    if (version && !versions[n]) versions[n] = version.replace(/^[\^~>=<\s]+/, '').trim();
  };

  let rootPkg: PackageJson | undefined;
  for (const f of byName('package.json').filter((f) => depth(f) <= MANIFEST_DEPTH)) {
    try {
      const pkg = JSON.parse(read(f) ?? '{}') as PackageJson;
      if (f === 'package.json') rootPkg = pkg;
      for (const block of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
        for (const [n, v] of Object.entries(block ?? {})) addDep(n, v);
      }
    } catch {
      // package.json invalide : ignoré, signalé par l'absence de dépendances
    }
  }
  for (const f of files.filter((f) => /(^|\/)requirements[\w.-]*\.txt$/.test(f) && depth(f) <= MANIFEST_DEPTH)) {
    for (const line of (read(f) ?? '').split(/\r?\n/)) {
      const m = line.trim().match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*(?:[=<>~!]=?\s*([\w.*-]+))?/);
      if (m && !line.trim().startsWith('#') && !line.trim().startsWith('-')) addDep(m[1]!, m[2]);
    }
  }
  for (const f of byName('pyproject.toml').filter((f) => depth(f) <= MANIFEST_DEPTH)) {
    for (const spec of pyprojectDependencySpecs(read(f) ?? '')) {
      const m = spec.match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*(?:[=<>~!]=?\s*([\w.*-]+))?/);
      if (m) addDep(m[1]!, m[2]);
    }
  }
  for (const f of byName('Pipfile')) for (const m of (read(f) ?? '').matchAll(/^([A-Za-z0-9_.-]+)\s*=/gm)) addDep(m[1]!);
  for (const f of byName('pubspec.yaml').filter((f) => depth(f) <= MANIFEST_DEPTH)) {
    const text = read(f) ?? '';
    let inDeps = false;
    for (const line of text.split(/\r?\n/)) {
      if (/^(dependencies|dev_dependencies):\s*$/.test(line)) {
        inDeps = true;
        continue;
      }
      if (/^\S/.test(line)) inDeps = false;
      const m = line.match(/^ {2}([a-z0-9_]+):\s*(.*)$/);
      if (inDeps && m) addDep(m[1]!, m[2] && !m[2].startsWith('{') ? m[2].replace(/['"]/g, '') : undefined);
    }
    if (/sdk:\s*flutter/.test(text)) addDep('flutter');
  }
  for (const f of byName('go.mod')) for (const m of (read(f) ?? '').matchAll(/^\s*(?:require\s+)?([\w.-]+\.[\w./-]+)\s+v([\w.+-]+)/gm)) addDep(m[1]!, m[2]);
  for (const f of byName('Cargo.toml').filter((f) => depth(f) <= MANIFEST_DEPTH)) {
    let inDeps = false;
    for (const line of (read(f) ?? '').split(/\r?\n/)) {
      if (/^\[.*dependencies.*\]/.test(line)) {
        inDeps = true;
        continue;
      }
      if (/^\[/.test(line)) inDeps = false;
      const m = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]+)"|\{.*version\s*=\s*"([^"]+)")?/);
      if (inDeps && m) addDep(m[1]!, m[2] ?? m[3]);
    }
  }
  for (const f of byName('Gemfile')) for (const m of (read(f) ?? '').matchAll(/^\s*gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/gm)) addDep(m[1]!, m[2]);
  for (const f of byName('composer.json')) {
    try {
      const c = JSON.parse(read(f) ?? '{}') as { require?: Record<string, string>; 'require-dev'?: Record<string, string> };
      for (const [n, v] of Object.entries({ ...c.require, ...c['require-dev'] })) addDep(n, v);
    } catch {
      /* ignoré */
    }
  }
  for (const f of [...byName('pom.xml'), ...byName(/^build\.gradle(\.kts)?$/)]) {
    const text = read(f) ?? '';
    for (const m of text.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)) addDep(m[1]!);
    for (const m of text.matchAll(/["']([\w.-]+):([\w.-]+):?([\w.-]*)["']/g)) addDep(m[2]!, m[3]);
    if (/com\.android\.(application|library)/.test(text)) addDep('android-gradle');
  }
  for (const f of byName(/\.csproj$/)) for (const m of (read(f) ?? '').matchAll(/PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/g)) addDep(m[1]!, m[2]);

  return { files, has: (rel) => fileSet.has(rel), read, byName, deps, versions, ...(rootPkg ? { packageJson: rootPkg } : {}), truncated };
}

export function hasAny(ctx: ScanContext, names: readonly string[]): boolean {
  return names.some((n) => ctx.deps.has(n));
}

export function matching(ctx: ScanContext, names: readonly string[]): string[] {
  return names.filter((n) => ctx.deps.has(n));
}

export function anyFile(ctx: ScanContext, pattern: RegExp): string | undefined {
  return ctx.files.find((f) => pattern.test(f));
}

/**
 * Extrait les spécifications de dépendances d'un pyproject.toml : [project] dependencies,
 * [project.optional-dependencies], [dependency-groups], [tool.uv] dev-dependencies, et les tables
 * Poetry ([tool.poetry.dependencies], [tool.poetry.group.*.dependencies]).
 */
export function pyprojectDependencySpecs(text: string): string[] {
  const specs: string[] = [];
  let section = '';
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      section = header[1]!.trim();
      continue;
    }
    const isPoetryTable = /^tool\.poetry\.(dev-)?dependencies$|^tool\.poetry\.group\.[^.]+\.dependencies$/.test(section);
    if (isPoetryTable) {
      const m = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*(?:"([^"]*)"|\{[^}]*version\s*=\s*"([^"]*)")/);
      if (m && m[1] !== 'python') specs.push(`${m[1]}${m[2] ?? m[3] ? `==${(m[2] ?? m[3])!.replace(/^[\^~>=<\s]+/, '')}` : ''}`);
      continue;
    }
    const arr = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*\[(.*)$/);
    if (!arr) continue;
    const key = arr[1]!;
    const relevant =
      (section === 'project' && key === 'dependencies') ||
      section === 'project.optional-dependencies' ||
      section === 'dependency-groups' ||
      (section === 'tool.uv' && key === 'dev-dependencies');
    if (!relevant) continue;
    let body = arr[2]!;
    // Fin du tableau : un `]` hors chaînes (les extras comme "psycopg[binary]" contiennent des crochets).
    const closed = (b: string) => b.replace(/"[^"]*"|'[^']*'/g, '').includes(']');
    while (!closed(body) && i + 1 < lines.length) body += `\n${lines[++i]!}`;
    for (const q of body.matchAll(/"([^"]+)"|'([^']+)'/g)) specs.push((q[1] ?? q[2])!.trim());
  }
  return specs;
}
