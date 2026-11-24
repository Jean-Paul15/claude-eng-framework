import * as path from 'node:path';
import { addFeature, FEATURE_STATUSES, featureLabel, getFeature, importFeatures, listFeatures, rejectFeature, replaceFeature, type FeatureStatus } from '../../app/features.js';
import { BrainStore } from '../../brain/store.js';
import { csv } from '../../app/tasks.js';
import { out, parse, requirePositional, requireStr, str, UsageError } from '../args.js';

/**
 * `ceng feature add|list|show|reject|replace|import` — registre des fonctionnalités (ce qui est décidé, en cours, livré,
 * écarté). Consulté à chaque demande : une fonctionnalité écartée ne se reproposera pas, une livrée ne se refera pas.
 */
export function featureCommand(argv: string[]): void {
  const [sub, ...rest] = argv;
  const p = parse(rest, { dir: { type: 'string' }, name: { type: 'string' }, summary: { type: 'string' }, surfaces: { type: 'string' }, spec: { type: 'string' }, keywords: { type: 'string' }, status: { type: 'string' }, reason: { type: 'string' }, by: { type: 'string' } });
  const store = new BrainStore(path.resolve(str(p, 'dir') ?? process.cwd()));
  store.requireInitialized();
  switch (sub) {
    case 'add': {
      const status = str(p, 'status');
      if (status && !(FEATURE_STATUSES as readonly string[]).includes(status)) throw new UsageError(`--status : ${FEATURE_STATUSES.join('|')}`);
      const f = addFeature(store, { name: requireStr(p, 'name'), summary: requireStr(p, 'summary'), surfaces: csv(str(p, 'surfaces')), spec: csv(str(p, 'spec')), keywords: csv(str(p, 'keywords')), ...(status ? { status: status as FeatureStatus } : {}) });
      out(p, `${f.id} enregistrée : ${f.name} (${featureLabel(f.status)}). Rattacher les tâches : task add --feature ${f.id}`, f);
      return;
    }
    case 'list': {
      const all = listFeatures(store).filter((f) => !str(p, 'status') || f.status === str(p, 'status'));
      out(p, all.map((f) => `${f.id} ${featureLabel(f.status).padEnd(10)} ${f.name} — ${f.summary}${f.reason ? ` (${f.reason})` : ''}`).join('\n') || 'Aucune fonctionnalité enregistrée.', all);
      return;
    }
    case 'show': {
      const f = getFeature(store, requirePositional(p, 0, 'fonctionnalité'));
      out(p, [`${f.id} ${f.name} — ${featureLabel(f.status)}`, f.summary, f.reason ? `Raison : ${f.reason}` : '', `Tâches : ${f.tasks.join(', ') || '—'} · exigences : ${f.spec.join(', ') || '—'}`, `Fichiers : ${f.files.join(', ') || '—'}`].filter(Boolean).join('\n'), f);
      return;
    }
    case 'reject': {
      const f = rejectFeature(store, requirePositional(p, 0, 'fonctionnalité'), requireStr(p, 'reason'));
      out(p, `${f.id} écartée : ${f.reason}`, f);
      return;
    }
    case 'replace': {
      const f = replaceFeature(store, requirePositional(p, 0, 'fonctionnalité'), requireStr(p, 'by'), requireStr(p, 'reason'));
      out(p, `${f.id} remplacée par ${f.replacedBy} : ${f.reason}`, f);
      return;
    }
    case 'import': {
      const added = importFeatures(store);
      out(p, added.length ? `${added.length} fonctionnalité(s) déduite(s) des groupes de tâches (à corriger par l'orchestrateur) :\n${added.map((f) => `  ${f.id} ${f.name} (${featureLabel(f.status)})`).join('\n')}` : 'Rien à importer (aucun groupe de tâches sans fonctionnalité).', added);
      return;
    }
    default:
      throw new UsageError('Usage : ceng feature add --name … --summary … | list | show <F-xxx> | reject <F-xxx> --reason … | replace <F-xxx> --by <F-yyy> --reason … | import');
  }
}
