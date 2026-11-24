import * as path from 'node:path';
import { checkDependency, currentDeps, ensureBaseline, readVetted, recordCheck, unvettedDeps, type CheckResult } from '../../app/deps.js';
import { depKey, type DepRef, type Ecosystem } from '../../domain/deps.js';
import { BrainStore } from '../../brain/store.js';
import { out, parse, str, UsageError } from '../args.js';

const ECOS = new Set<string>(['npm', 'pypi', 'cargo', 'go', 'pub']);
const ICON = { ok: '✔', review: '⚠', reject: '✖' } as const;

function render(r: CheckResult, recorded: boolean): string {
  const m = r.meta;
  const head = `${ICON[r.assessment.verdict]} ${r.dep.eco}:${r.dep.name}${m?.version ? ` ${m.version}` : ''} — ${m?.license ?? 'licence ?'}${m?.weeklyDownloads !== undefined ? ` · ${m.weeklyDownloads} téléch./sem.` : ''}${m?.lastPublish ? ` · publiée ${m.lastPublish.slice(0, 10)}` : ''}`;
  const why = r.assessment.reasons.map((x) => `    - ${x}`);
  const next = r.assessment.verdict === 'reject' && !recorded ? ['    → Garder malgré tout : `ceng dep check ' + r.dep.name + ' --accept "raison"` ; sinon choisir une alternative.'] : [];
  return [head, ...why, ...next].join('\n');
}

/**
 * `ceng dep check [noms…] [--eco npm|pypi|cargo|go|pub] [--accept "raison"]` : licence, maintenance, vulnérabilités connues et usage
 * d'une dépendance d'après son registre public. Sans nom : toutes celles que les manifestes déclarent sans vérification.
 * `ceng dep list` : l'état ; `ceng dep baseline` : fige les dépendances actuelles comme référence.
 */
export async function depCommand(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  const p = parse(rest, { dir: { type: 'string' }, eco: { type: 'string' }, accept: { type: 'string' } });
  const store = new BrainStore(path.resolve(str(p, 'dir') ?? process.cwd()));
  store.requireInitialized();
  if (sub === 'baseline') {
    out(p, ensureBaseline(store) ? 'Référence créée : les dépendances actuelles ne seront pas rejugées.' : 'Référence déjà présente.', {});
    return;
  }
  if (sub === 'list') {
    const vetted = readVetted(store) ?? {};
    const lines = currentDeps(store.paths.root).map((d) => `${vetted[depKey(d)]?.verdict ?? 'NON VÉRIFIÉE'}`.padEnd(14) + depKey(d) + (d.dev ? ' (dev)' : ''));
    out(p, lines.join('\n') || 'Aucune dépendance déclarée.', { deps: lines });
    return;
  }
  if (sub !== 'check') throw new UsageError('Usage : ceng dep check [noms…] [--eco npm|pypi|cargo|go|pub] [--accept "raison"] | list | baseline');
  const eco = str(p, 'eco');
  if (eco && !ECOS.has(eco)) throw new UsageError(`--eco : ${[...ECOS].join('|')}`);
  const known = currentDeps(store.paths.root);
  const present = [...new Set(known.map((d) => d.eco))];
  const targets: DepRef[] = p.positionals.length
    ? p.positionals.map((name) => {
        const found = known.find((d) => d.name === name && (!eco || d.eco === eco));
        const e = (eco as Ecosystem | undefined) ?? found?.eco ?? (present.length === 1 ? present[0]! : undefined);
        if (!e) throw new UsageError(`Écosystème de « ${name} » inconnu : ajouter --eco (${[...ECOS].join('|')}).`);
        return { name, eco: e, dev: found?.dev ?? false };
      })
    : unvettedDeps(store);
  if (!targets.length) {
    out(p, 'Rien à vérifier : toutes les dépendances déclarées le sont déjà.', {});
    return;
  }
  const accept = str(p, 'accept');
  const results: { r: CheckResult; recorded: boolean }[] = [];
  for (const dep of targets) {
    const r = await checkDependency(dep);
    results.push({ r, recorded: recordCheck(store, r, accept) });
  }
  const blocked = results.filter((x) => !x.recorded);
  out(p, [...results.map((x) => render(x.r, x.recorded)), '', blocked.length ? `${blocked.length} dépendance(s) non enregistrée(s) : alternative, ou --accept "raison".` : 'Vérification enregistrée : citer ces choix et leurs réserves dans le rapport de la tâche.'].join('\n'), { results: results.map((x) => ({ dep: x.r.dep, verdict: x.r.assessment.verdict, reasons: x.r.assessment.reasons, recorded: x.recorded })) });
  if (blocked.length) process.exitCode = 1;
}

