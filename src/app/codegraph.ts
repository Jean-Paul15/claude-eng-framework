import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { run } from '../infra/exec.js';
import { ensureDir, exists } from '../infra/fs.js';
import type { BrainStore } from '../brain/store.js';

/**
 * Graphe de code (graphify) construit et maintenu automatiquement.
 * Uniquement le mode code (`--code-only`, AST local) et sans clustering : zéro appel LLM, zéro coût,
 * déterministe. La construction sémantique complète (docs, images) reste une action volontaire (`/graphify`).
 */

export const GRAPH_DIR = 'graphify-out';
const LOCK_STALE_MS = 10 * 60_000;
const PYPI_PACKAGE = 'graphifyy';

export function graphPath(root: string): string {
  return path.join(root, GRAPH_DIR, 'graph.json');
}

export function graphDisabledByEnv(): boolean {
  return process.env['CENG_NO_CODE_GRAPH'] === '1';
}

export function graphifyAvailable(cwd: string): boolean {
  const r = run(process.platform === 'win32' ? 'where' : 'which', ['graphify'], { cwd, timeoutMs: 5000 });
  return r.code === 0 && r.stdout.trim().length > 0;
}

export interface InstallAttempt {
  ok: boolean;
  via?: string;
  log: string[];
}

/** Installe la CLI graphify (paquet PyPI `graphifyy`) avec le premier gestionnaire Python disponible. */
export function installGraphify(cwd: string): InstallAttempt {
  const log: string[] = [];
  const attempts: [string, string, string[]][] = [
    ['uv', 'uv', ['tool', 'install', PYPI_PACKAGE]],
    ['pipx', 'pipx', ['install', PYPI_PACKAGE]],
    ['pip', process.platform === 'win32' ? 'py' : 'python3', ['-m', 'pip', 'install', '--user', PYPI_PACKAGE]],
  ];
  for (const [label, bin, args] of attempts) {
    const r = run(bin, args, { cwd, timeoutMs: 5 * 60_000 });
    log.push(`${bin} ${args.join(' ')} → exit ${r.code}`);
    if (r.code === 0 && graphifyAvailable(cwd)) return { ok: true, via: label, log };
  }
  return { ok: false, log };
}

/** Construction synchrone (init, `ceng graph build`). */
export function buildGraph(root: string): { ok: boolean; detail: string } {
  const r = run('graphify', ['extract', root, '--code-only', '--no-cluster'], { cwd: root, timeoutMs: 10 * 60_000 });
  const last = `${r.stdout}\n${r.stderr}`.trim().split(/\r?\n/).filter((l) => l.includes('wrote') || l.includes('error') || l.includes('Error')).pop();
  return { ok: r.code === 0 && exists(graphPath(root)), detail: last ?? `exit ${r.code}` };
}

function lockFile(store: BrainStore): string {
  return path.join(store.paths.logs, 'graphify.lock');
}

function locked(store: BrainStore): boolean {
  try {
    return Date.now() - fs.statSync(lockFile(store)).mtimeMs < LOCK_STALE_MS;
  } catch {
    return false;
  }
}

export interface RefreshDecision {
  action: 'none' | 'build' | 'update';
  reason: string;
}

/** Décision pure : faut-il (re)construire le graphe maintenant ? */
export function decideRefresh(input: { enabled: boolean; available: boolean; graphExists: boolean; dirty: boolean; locked: boolean; trigger: 'session-start' | 'turn-end' }): RefreshDecision {
  if (!input.enabled) return { action: 'none', reason: 'graphe de code désactivé' };
  if (!input.available) return { action: 'none', reason: 'graphify non installé' };
  if (input.locked) return { action: 'none', reason: 'mise à jour déjà en cours' };
  if (!input.graphExists) return { action: 'build', reason: 'graphe absent' };
  // Au démarrage, le code a pu changer hors de Claude (git pull, éditeur) : mise à jour systématique, sans coût LLM.
  if (input.trigger === 'session-start') return { action: 'update', reason: 'synchronisation de début de session' };
  return input.dirty ? { action: 'update', reason: 'fichiers modifiés pendant le tour' } : { action: 'none', reason: 'aucune modification' };
}

/** Lance la construction / mise à jour en arrière-plan (détachée) : n'ajoute aucune latence à la session. */
export function refreshInBackground(store: BrainStore, action: 'build' | 'update'): void {
  const root = store.paths.root;
  ensureDir(store.paths.logs);
  const out = fs.openSync(path.join(store.paths.logs, 'graphify.log'), 'a');
  fs.writeFileSync(lockFile(store), String(Date.now()));
  const args = action === 'build' ? ['extract', root, '--code-only', '--no-cluster'] : ['update', root, '--no-cluster'];
  // Le verrou est retiré par un petit processus Node qui attend la fin de graphify.
  const script = `const {spawnSync}=require('node:child_process');const fs=require('node:fs');` +
    `spawnSync('graphify',${JSON.stringify(args)},{stdio:'inherit',windowsHide:true});` +
    `try{fs.rmSync(${JSON.stringify(lockFile(store))},{force:true})}catch{}`;
  const child = spawn(process.execPath, ['-e', script], { cwd: root, detached: true, stdio: ['ignore', out, out], windowsHide: true });
  child.unref();
  fs.closeSync(out);
}

export function refreshIfNeeded(store: BrainStore, trigger: 'session-start' | 'turn-end'): RefreshDecision {
  const config = store.config();
  const enabled = (config.codeGraph?.enabled ?? false) && !graphDisabledByEnv();
  const state = store.state();
  const decision = decideRefresh({
    enabled,
    available: enabled && graphifyAvailable(store.paths.root),
    graphExists: exists(graphPath(store.paths.root)),
    dirty: state.graphDirty ?? false,
    locked: locked(store),
    trigger,
  });
  if (decision.action !== 'none') {
    refreshInBackground(store, decision.action);
    store.updateState((s) => {
      s.graphDirty = false;
    });
  }
  return decision;
}
