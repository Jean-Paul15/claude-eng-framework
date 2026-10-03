import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { run } from './exec.js';

/** Accès git via execFile (jamais de shell). Toutes les opérations sont non destructives sauf `restoreSnapshot`. */
export class Git {
  constructor(private readonly cwd: string) {}

  private git(args: string[], env?: NodeJS.ProcessEnv) {
    return run('git', args, { cwd: this.cwd, timeoutMs: 60_000, env: env ? { ...process.env, ...env } : process.env });
  }

  private out(args: string[], env?: NodeJS.ProcessEnv): string | undefined {
    const r = this.git(args, env);
    return r.code === 0 ? r.stdout.trim() : undefined;
  }

  isRepo(): boolean {
    return this.out(['rev-parse', '--is-inside-work-tree']) === 'true';
  }

  head(): string | undefined {
    return this.out(['rev-parse', 'HEAD']);
  }

  currentBranch(): string | undefined {
    return this.out(['branch', '--show-current']) || undefined;
  }

  defaultBranch(): string | undefined {
    const remoteHead = this.out(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
    if (remoteHead) return remoteHead.replace(/^origin\//, '');
    const branches = this.out(['branch', '--format=%(refname:short)'])?.split(/\r?\n/) ?? [];
    return ['main', 'master', 'trunk', 'develop'].find((b) => branches.includes(b)) ?? branches[0];
  }

  remotes(): string[] {
    return (this.out(['remote']) ?? '').split(/\r?\n/).filter(Boolean);
  }

  /** Sujets des derniers commits (pour détecter la convention de messages). */
  recentSubjects(n = 30): string[] {
    return (this.out(['log', `-${n}`, '--format=%s']) ?? '').split(/\r?\n/).filter(Boolean);
  }

  statusPorcelain(): string[] {
    return (this.out(['status', '--porcelain']) ?? '').split(/\r?\n/).filter(Boolean);
  }

  changedFiles(): string[] {
    return this.statusPorcelain()
      .map((l) => l.slice(3).trim())
      .map((f) => (f.includes(' -> ') ? f.split(' -> ')[1]! : f))
      .map((f) => f.replace(/^"|"$/g, ''));
  }

  /**
   * Instantané complet de l'arbre de travail (fichiers non suivis inclus, .gitignore respecté)
   * sans toucher ni l'index réel ni les fichiers : index temporaire + write-tree + commit-tree.
   */
  snapshot(ref: string, message: string): string | undefined {
    const tmpIndex = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ceng-idx-')), 'index');
    try {
      const env = { GIT_INDEX_FILE: tmpIndex };
      const head = this.head();
      if (head && this.git(['read-tree', head], env).code !== 0) return undefined;
      if (this.git(['add', '-A'], env).code !== 0) return undefined;
      const tree = this.out(['write-tree'], env);
      if (!tree) return undefined;
      const args = ['commit-tree', tree, '-m', message];
      if (head) args.splice(2, 0, '-p', head);
      const commit = this.out(args, {
        ...env,
        GIT_AUTHOR_NAME: 'ceng', GIT_AUTHOR_EMAIL: 'ceng@localhost',
        GIT_COMMITTER_NAME: 'ceng', GIT_COMMITTER_EMAIL: 'ceng@localhost',
      });
      if (!commit) return undefined;
      if (this.git(['update-ref', ref, commit]).code !== 0) return undefined;
      return commit;
    } finally {
      fs.rmSync(path.dirname(tmpIndex), { recursive: true, force: true });
    }
  }

  /** Fichiers ignorés par git sous un chemin (non capturés par un instantané). */
  ignoredFiles(rel: string): string[] {
    return (this.out(['ls-files', '--others', '--ignored', '--exclude-standard', '--', rel]) ?? '').split(/\r?\n/).filter(Boolean);
  }

  hasCommit(sha: string): boolean {
    return this.git(['cat-file', '-e', `${sha}^{commit}`]).code === 0;
  }

  diffStat(fromCommit: string): string {
    return this.out(['diff', '--stat', fromCommit]) ?? '';
  }

  filesChangedSince(commit: string): string[] {
    const tracked = (this.out(['diff', '--name-only', commit]) ?? '').split(/\r?\n/).filter(Boolean);
    const untracked = (this.out(['ls-files', '--others', '--exclude-standard']) ?? '').split(/\r?\n/).filter(Boolean);
    return [...new Set([...tracked, ...untracked])];
  }

  /**
   * Restaure l'arbre de travail tel qu'il était dans un instantané.
   * L'appelant DOIT avoir pris un instantané de sécurité de l'état courant juste avant.
   * Les fichiers créés après l'instantané sont conservés (jamais supprimés) et signalés.
   */
  restoreSnapshot(commit: string): { ok: boolean; created: string[]; error?: string } {
    const created = (this.out(['diff', '--name-only', '--diff-filter=A', commit]) ?? '').split(/\r?\n/).filter(Boolean);
    const untrackedNow = (this.out(['ls-files', '--others', '--exclude-standard']) ?? '').split(/\r?\n/).filter(Boolean);
    const snapshotFiles = new Set((this.out(['ls-tree', '-r', '--name-only', commit]) ?? '').split(/\r?\n/));
    const r = this.git(['restore', `--source=${commit}`, '--worktree', '--', '.']);
    if (r.code !== 0) return { ok: false, created: [], error: r.stderr.trim() };
    return { ok: true, created: [...new Set([...created, ...untrackedNow.filter((f) => !snapshotFiles.has(f))])] };
  }

  listRefs(prefix: string): { ref: string; commit: string }[] {
    return (this.out(['for-each-ref', '--format=%(refname) %(objectname)', prefix]) ?? '')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        const [ref, commit] = l.split(' ');
        return { ref: ref!, commit: commit! };
      });
  }
}
