import * as path from 'node:path';
import { writeDataMap } from '../../app/data-map.js';
import { runReady } from '../../app/ready.js';
import { BrainStore } from '../../brain/store.js';
import { out, parse, str } from '../args.js';

const ICON = { pass: '✔', fail: '✖', skipped: '–' } as const;

/** `ceng ready` : contrôle « prêt pour la production » (code de sortie 1 s'il reste un échec). */
export function readyCommand(argv: string[]): void {
  const p = parse(argv, { dir: { type: 'string' } });
  const store = new BrainStore(path.resolve(str(p, 'dir') ?? process.cwd()));
  store.requireInitialized();
  const r = runReady(store);
  const lines = r.checks.map((c) => `${ICON[c.status]} ${c.title} — ${c.detail}${c.status === 'fail' && c.fix ? `\n    → ${c.fix}` : ''}`);
  out(p, [...lines, '', r.ok ? 'Prêt pour la production : tous les contrôles applicables sont verts.' : r.summary].join('\n'), r);
  if (!r.ok) process.exitCode = 1;
}

/** `ceng data-map` : génère `.ceng/brain/data-map.md` depuis les commentaires de colonnes des migrations. */
export function dataMapCommand(argv: string[]): void {
  const p = parse(argv, { dir: { type: 'string' } });
  const store = new BrainStore(path.resolve(str(p, 'dir') ?? process.cwd()));
  store.requireInitialized();
  const r = writeDataMap(store);
  out(p, `Carte des données écrite : ${r.file} (${r.entries} donnée(s) personnelle(s) classée(s)).`, r);
}
