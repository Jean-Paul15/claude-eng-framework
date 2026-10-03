import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildGraph, graphDisabledByEnv, graphifyAvailable, graphPath, installGraphify } from '../../app/codegraph.js';
import { BrainStore } from '../../brain/store.js';
import { exists } from '../../infra/fs.js';
import { out, parse, str, UsageError } from '../args.js';

/** `ceng graph status|install|build|enable|disable` — graphe de code graphify (mode code, sans LLM). */
export function graphCommand(argv: string[]): void {
  const [sub, ...rest] = argv;
  const p = parse(rest, { dir: { type: 'string' } });
  const store = new BrainStore(path.resolve(str(p, 'dir') ?? process.cwd()));
  store.requireInitialized();
  const root = store.paths.root;
  switch (sub ?? 'status') {
    case 'status': {
      const config = store.config();
      const file = graphPath(root);
      const info = {
        enabled: config.codeGraph?.enabled ?? false,
        graphifyInstalled: graphifyAvailable(root),
        graphExists: exists(file),
        updatedAt: exists(file) ? fs.statSync(file).mtime.toISOString() : null,
        pendingChanges: store.state().graphDirty ?? false,
      };
      const human = [
        `Graphe de code : ${info.enabled ? 'activé (mise à jour automatique par les hooks)' : 'désactivé'}`,
        `graphify : ${info.graphifyInstalled ? 'installé' : 'absent → `ceng graph install`'}`,
        `Graphe : ${info.graphExists ? `${path.relative(root, file)} (mis à jour ${info.updatedAt})` : 'pas encore construit → `ceng graph build`'}`,
        info.pendingChanges ? 'Modifications en attente : mise à jour à la fin du tour en cours.' : '',
      ].filter(Boolean).join('\n');
      out(p, human, info);
      return;
    }
    case 'install': {
      if (graphifyAvailable(root)) {
        out(p, 'graphify est déjà installé.', { ok: true, already: true });
        return;
      }
      const r = installGraphify(root);
      out(p, r.ok ? `graphify installé via ${r.via}.` : `Échec de l'installation de graphify :\n${r.log.join('\n')}\nInstaller manuellement : \`uv tool install graphifyy\` ou \`pipx install graphifyy\`.`, r);
      if (!r.ok) process.exitCode = 1;
      return;
    }
    case 'build': {
      if (!graphifyAvailable(root)) throw new UsageError('graphify absent : `ceng graph install` d\'abord.');
      const r = buildGraph(root);
      store.updateState((s) => {
        s.graphDirty = false;
      });
      store.log({ type: 'graph.refresh', data: { action: 'build', ok: r.ok } });
      out(p, r.ok ? `Graphe construit : ${r.detail}` : `Échec : ${r.detail}`, r);
      if (!r.ok) process.exitCode = 1;
      return;
    }
    case 'enable':
    case 'disable': {
      const config = store.config();
      store.saveConfig({ ...config, codeGraph: { enabled: sub === 'enable' } });
      out(p, `Graphe de code ${sub === 'enable' ? 'activé' : 'désactivé'}.`, { enabled: sub === 'enable' });
      return;
    }
    default:
      throw new UsageError('ceng graph status|install|build|enable|disable');
  }
}

/** Étape d'init : installe (si demandé) puis construit le graphe. Ne fait jamais échouer l'init. */
export function setupGraphAtInit(root: string, opts: { enabled: boolean; install: boolean; dryRun: boolean }): string[] {
  if (!opts.enabled || opts.dryRun || graphDisabledByEnv()) return [];
  const notes: string[] = [];
  let available = graphifyAvailable(root);
  if (!available && opts.install) {
    const r = installGraphify(root);
    available = r.ok;
    notes.push(r.ok ? `graphify installé (${r.via}).` : 'Installation de graphify impossible : `uv tool install graphifyy` ou `pipx install graphifyy`, puis `ceng graph build`.');
  }
  if (!available) {
    if (!opts.install) notes.push('Graphe de code activé mais graphify absent : `ceng graph install` (ou relancer init avec --install-graphify).');
    return notes;
  }
  const r = buildGraph(root);
  notes.push(r.ok ? `Graphe de code construit (${r.detail.replace(/^.*— /, '')}) ; mis à jour automatiquement ensuite.` : `Construction du graphe échouée : ${r.detail}`);
  return notes;
}

export function graphEnabledFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'on') return true;
  if (value === 'off') return false;
  throw new UsageError('--code-graph : on|off');
}
