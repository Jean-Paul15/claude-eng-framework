import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRegistry } from '../../app/registry.js';
import { BrainPaths } from '../../brain/paths.js';
import { exists } from '../../infra/fs.js';
import { out, parse } from '../args.js';

/**
 * `ceng upgrade --all` : met à jour, avec CE framework, tous les projets initialisés sur la machine (registre local).
 * Chaque mise à jour est celle de `ceng upgrade` (non destructive). Un projet déplacé ou supprimé est simplement ignoré.
 */
export function upgradeAll(argv: string[]): void {
  const p = parse(argv, {});
  const cli = fileURLToPath(new URL('../../cli.js', import.meta.url));
  const results = readRegistry().projects.map((root) => {
    if (!exists(new BrainPaths(root).config)) return { root, status: 'ignoré (introuvable ou non initialisé)' };
    const r = spawnSync(process.execPath, [cli, 'upgrade', '--dir', root], { cwd: root, encoding: 'utf8', windowsHide: true });
    return { root, status: r.status === 0 ? 'à jour' : `échec : ${(r.stderr || r.stdout).trim().split('\n').pop()}` };
  });
  out(p, results.length
    ? [`Projets de cette machine (${results.length}) :`, ...results.map((r) => `  ${r.status.padEnd(12)} ${path.normalize(r.root)}`), '', 'Ouvrir une nouvelle session dans chaque projet pour charger les nouvelles skills.'].join('\n')
    : 'Aucun projet enregistré sur cette machine (les projets s\'enregistrent à leur prochain `ceng init` ou `ceng upgrade`).', results);
}
