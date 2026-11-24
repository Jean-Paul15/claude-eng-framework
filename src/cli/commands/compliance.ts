import * as path from 'node:path';
import { applies, checkCompliance, readManifest, writeManifest } from '../../app/compliance.js';
import { MECHANISMS } from '../../domain/compliance.js';
import { csv } from '../../app/tasks.js';
import { BrainStore } from '../../brain/store.js';
import { out, parse, requirePositional, requireStr, str, UsageError } from '../args.js';

const ICON = { implemented: '✔', waived: '–', missing: '✖' } as const;

/**
 * `ceng compliance status | set <C-xx> --files … [--tests …] | waive <C-xx> --decision <ADR>`.
 * `waive` est une décision de l'humain : sans bypass, la garde la soumet à son approbation.
 */
export function complianceCommand(argv: string[]): void {
  const [sub, ...rest] = argv;
  const p = parse(rest, { dir: { type: 'string' }, files: { type: 'string' }, tests: { type: 'string' }, decision: { type: 'string' } });
  const store = new BrainStore(path.resolve(str(p, 'dir') ?? process.cwd()));
  store.requireInitialized();
  const known = (id: string) => {
    if (!MECHANISMS.some((m) => m.id === id.toUpperCase())) throw new UsageError(`Mécanisme inconnu : ${id} (C-01 à C-14, voir \`ceng compliance status\`).`);
    return id.toUpperCase();
  };
  switch (sub ?? 'status') {
    case 'status': {
      const rows = checkCompliance(store);
      const miss = rows.filter((r) => r.status === 'missing').length;
      out(p, [`Socle de conformité : ${applies(store) ? `${rows.length - miss}/${rows.length} en place ou écartés` : 'sans objet (ni compte ni donnée personnelle détectés)'}`, ...rows.map((r) => `${ICON[r.status]} ${r.mechanism.id} ${r.mechanism.title} — ${r.detail}`)].join('\n'), rows);
      return;
    }
    case 'set': {
      const id = known(requirePositional(p, 0, 'mécanisme'));
      const m = readManifest(store);
      m[id] = { status: 'implemented', files: csv(requireStr(p, 'files')), ...(str(p, 'tests') ? { tests: csv(str(p, 'tests')) } : {}) };
      writeManifest(store, m);
      out(p, `${id} déclaré : ${m[id]!.files!.join(', ')}${m[id]!.tests ? ` · tests ${m[id]!.tests!.join(', ')}` : ''}`, m[id]);
      return;
    }
    case 'waive': {
      const id = known(requirePositional(p, 0, 'mécanisme'));
      const m = readManifest(store);
      m[id] = { status: 'waived', decision: requireStr(p, 'decision') };
      writeManifest(store, m);
      out(p, `${id} écarté par la décision ${m[id]!.decision} (vérifiée à chaque \`ceng ready\`).`, m[id]);
      return;
    }
    default:
      throw new UsageError('Usage : ceng compliance status | set <C-xx> --files … [--tests …] | waive <C-xx> --decision <fichier ADR>');
  }
}
