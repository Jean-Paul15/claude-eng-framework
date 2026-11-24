import * as path from 'node:path';
import { allMechanisms, applies, checkCompliance, readManifest, writeManifest } from '../../app/compliance.js';
import { CUSTOM_ID } from '../../domain/compliance.js';
import { csv } from '../../app/tasks.js';
import { BrainStore } from '../../brain/store.js';
import { bool, out, parse, requirePositional, requireStr, str, UsageError } from '../args.js';

const ICON = { implemented: '✔', waived: '–', missing: '✖' } as const;

/**
 * `ceng compliance status | set <C-xx> --files … [--tests …] | waive <C-xx> --decision <ADR>`.
 * `waive` est une décision de l'humain : sans bypass, la garde la soumet à son approbation.
 */
export function complianceCommand(argv: string[]): void {
  const [sub, ...rest] = argv;
  const p = parse(rest, { dir: { type: 'string' }, files: { type: 'string' }, tests: { type: 'string' }, decision: { type: 'string' }, title: { type: 'string' }, because: { type: 'string' }, test: { type: 'boolean' } });
  const store = new BrainStore(path.resolve(str(p, 'dir') ?? process.cwd()));
  store.requireInitialized();
  const known = (id: string) => {
    if (!allMechanisms(readManifest(store)).some((m) => m.id === id.toUpperCase())) throw new UsageError(`Mécanisme inconnu : ${id} (C-01 à C-14 ou un mécanisme du projet X-01…, voir \`ceng compliance status\`).`);
    return id.toUpperCase();
  };
  switch (sub ?? 'status') {
    case 'status': {
      const rows = checkCompliance(store);
      const miss = rows.filter((r) => r.status === 'missing').length;
      out(p, [`Socle de conformité : ${applies(store) ? `${rows.length - miss}/${rows.length} en place ou écartés` : 'sans objet (ni compte ni donnée personnelle détectés)'}`, ...rows.map((r) => `${ICON[r.status]} ${r.mechanism.id} ${r.mechanism.title} — ${r.detail}`)].join('\n'), rows);
      return;
    }
    case 'add': {
      // Le socle est une base minimale : une nouvelle loi, un nouveau traitement ou l'exigence d'un client ajoute un mécanisme.
      const id = requirePositional(p, 0, 'identifiant X-01').toUpperCase();
      if (!CUSTOM_ID.test(id)) throw new UsageError('Identifiant d\'un mécanisme du projet : X-01, X-02…');
      const m = readManifest(store);
      if (m[id]) throw new UsageError(`${id} existe déjà.`);
      m[id] = { status: 'pending', title: requireStr(p, 'title'), needsTest: bool(p, 'test'), ...(str(p, 'because') ? { because: str(p, 'because')! } : {}) };
      writeManifest(store, m);
      out(p, `${id} ajouté : ${m[id]!.title} — à construire puis déclarer (compliance set ${id} --files …).`, m[id]);
      return;
    }
    case 'set': {
      const id = known(requirePositional(p, 0, 'mécanisme'));
      const m = readManifest(store);
      m[id] = { ...(m[id]?.title ? { title: m[id]!.title, needsTest: m[id]!.needsTest === true } : {}), status: 'implemented', files: csv(requireStr(p, 'files')), ...(str(p, 'tests') ? { tests: csv(str(p, 'tests')) } : {}) };
      writeManifest(store, m);
      out(p, `${id} déclaré : ${m[id]!.files!.join(', ')}${m[id]!.tests ? ` · tests ${m[id]!.tests!.join(', ')}` : ''}`, m[id]);
      return;
    }
    case 'waive': {
      const id = known(requirePositional(p, 0, 'mécanisme'));
      const m = readManifest(store);
      m[id] = { ...(m[id]?.title ? { title: m[id]!.title } : {}), status: 'waived', decision: requireStr(p, 'decision') };
      writeManifest(store, m);
      out(p, `${id} écarté par la décision ${m[id]!.decision} (vérifiée à chaque \`ceng ready\`).`, m[id]);
      return;
    }
    default:
      throw new UsageError('Usage : ceng compliance status | add <X-01> --title … [--because …] [--test] | set <C-xx|X-xx> --files … [--tests …] | waive <C-xx> --decision <fichier ADR>');
  }
}
