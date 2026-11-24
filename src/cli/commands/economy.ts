import * as path from 'node:path';
import { addCost, estimateCosts, readCosts } from '../../app/costs.js';
import { readBaseline, resetBaseline } from '../../app/perf.js';
import { BrainStore } from '../../brain/store.js';
import { out, parse, requireStr, str, UsageError } from '../args.js';

function open(p: ReturnType<typeof parse>): BrainStore {
  const store = new BrainStore(path.resolve(str(p, 'dir') ?? process.cwd()));
  store.requireInitialized();
  return store;
}

/** `ceng perf show | reset [métrique]` : références de performance (la gate `performance` les compare à chaque tâche). */
export function perfCommand(argv: string[]): void {
  const [sub, ...rest] = argv;
  const p = parse(rest, { dir: { type: 'string' } });
  const store = open(p);
  if (sub === 'reset') {
    resetBaseline(store, p.positionals[0]);
    out(p, p.positionals[0] ? `Référence ${p.positionals[0]} effacée.` : 'Références effacées.', {});
    return;
  }
  if (sub && sub !== 'show') throw new UsageError('Usage : ceng perf show | reset [métrique]');
  const base = readBaseline(store);
  out(p, Object.entries(base).map(([k, b]) => `${k} = ${b.value} (${b.at.slice(0, 10)}${b.task ? `, ${b.task}` : ''})`).join('\n') || 'Aucune référence : la commande `performance` doit écrire des lignes clé=valeur.', base);
}

/**
 * `ceng cost add --name … --unit … --price <usd> --per-user <n> --free <n> --source <url>` ajoute un service payant ;
 * `ceng cost [--users N]` estime la facture mensuelle (palier gratuit déduit) et la compare à `costBudgetUsd` s'il est défini.
 */
export function costCommand(argv: string[]): void {
  const [first, ...more] = argv;
  const sub = first === 'add' ? 'add' : 'show';
  const p = parse(sub === 'add' ? more : argv, { dir: { type: 'string' }, name: { type: 'string' }, unit: { type: 'string' }, price: { type: 'string' }, 'per-user': { type: 'string' }, free: { type: 'string' }, source: { type: 'string' }, users: { type: 'string' } });
  const store = open(p);
  if (sub === 'add') {
    const line = addCost(store, { name: requireStr(p, 'name'), unit: requireStr(p, 'unit'), unitPriceUsd: Number(requireStr(p, 'price')), perActiveUserPerMonth: Number(str(p, 'per-user') ?? '0'), freeTier: Number(str(p, 'free') ?? '0'), source: requireStr(p, 'source') });
    out(p, `${line.name} : ${line.unitPriceUsd} $ par ${line.unit} (source ${line.source}, vérifiée le ${line.checkedAt}).`, line);
    return;
  }
  const costs = readCosts(store);
  const users = Number(str(p, 'users') ?? '1000');
  const e = estimateCosts(costs, users);
  const budget = store.config().costBudgetUsd;
  out(p, costs.length
    ? [`Facture mensuelle estimée pour ${users} utilisateurs actifs : ${e.totalUsd} $`, ...e.lines.map((l) => `  - ${l.name} : ${l.usage} ${costs.find((c) => c.name === l.name)!.unit} (dont ${l.billable} facturés) → ${l.usd} $`), ...(budget !== undefined ? [e.totalUsd > budget ? `⚠ Dépasse le budget visé (${budget} $) : décision à poser à l'humain (réduire l'usage, changer de service, ou relever le budget).` : `Dans le budget visé (${budget} $).`] : ['Budget mensuel visé non défini : le demander à l\'humain au cadrage (costBudgetUsd).'])].join('\n')
    : 'Aucun service payant enregistré (ceng cost add …).', e);
}
