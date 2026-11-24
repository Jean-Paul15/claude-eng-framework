import * as path from 'node:path';
import { bumpContract, contractDrift, freezeContracts, listContracts } from '../../app/contracts.js';
import { closeIncrement } from '../../app/increments.js';
import { inboxItems, inboxSummary } from '../../app/inbox.js';
import { BrainStore } from '../../brain/store.js';
import { out, parse, requirePositional, requireStr, str, UsageError } from '../args.js';

function open(p: ReturnType<typeof parse>): BrainStore {
  const store = new BrainStore(path.resolve(str(p, 'dir') ?? process.cwd()));
  store.requireInitialized();
  return store;
}

/** `ceng contract freeze <fichiers…> | bump <fichier> --reason … | list` : contrats partagés gelés entre agents. */
export function contractCommand(argv: string[]): void {
  const [sub, ...rest] = argv;
  const p = parse(rest, { dir: { type: 'string' }, reason: { type: 'string' } });
  const store = open(p);
  switch (sub ?? 'list') {
    case 'freeze': {
      if (!p.positionals.length) throw new UsageError('Usage : ceng contract freeze <fichier…>');
      const added = freezeContracts(store, p.positionals);
      out(p, added.length ? `Gelé : ${added.map((c) => c.file).join(', ')}. Un sous-agent ne peut plus les modifier ; changement : ceng contract bump <fichier> --reason "…".` : 'Déjà gelés.', added);
      return;
    }
    case 'bump': {
      const { contract, concerned } = bumpContract(store, requirePositional(p, 0, 'fichier'));
      out(p, `${contract.file} → version ${contract.version} (${requireStr(p, 'reason')}).${concerned.length ? ` Tâches en cours à prévenir : ${concerned.map((t) => t.id).join(', ')}.` : ''}`, { contract, concerned: concerned.map((t) => t.id) });
      return;
    }
    case 'list': {
      const drift = new Set(contractDrift(store).map((c) => c.file));
      const all = listContracts(store);
      out(p, all.map((c) => `v${c.version} ${c.file}${drift.has(c.file) ? '  ⚠ modifié sans bump' : ''}`).join('\n') || 'Aucun contrat gelé.', all);
      return;
    }
    default:
      throw new UsageError('Usage : ceng contract freeze <fichier…> | bump <fichier> --reason … | list');
  }
}

/** `ceng inbox` : tout ce qui attend l'humain, trié (bloquant d'abord). */
export function inboxCommand(argv: string[]): void {
  const p = parse(argv, { dir: { type: 'string' } });
  const items = inboxItems(open(p));
  out(p, items.length ? [inboxSummary(items), ...items.map((i) => `${i.level === 'blocking' ? '● BLOQUANT' : '○ à confirmer'} ${i.question}\n    par défaut : ${i.default} [${i.ref}]`)].join('\n') : 'Rien n\'attend l\'humain.', items);
}

/** `ceng increment close <groupe>` : clôture d'un incrément (tout est terminé, vu, testé) et rapport d'incrément. */
export function incrementCommand(argv: string[]): void {
  const [sub, ...rest] = argv;
  if (sub !== 'close') throw new UsageError('Usage : ceng increment close <groupe>');
  const p = parse(rest, { dir: { type: 'string' } });
  const r = closeIncrement(open(p), requirePositional(p, 0, 'groupe'));
  const icon = { pass: '✔', fail: '✖', skipped: '–' } as const;
  out(p, [...r.checks.map((c) => `${icon[c.status]} ${c.title} — ${c.detail}`), '', r.ok ? `Incrément livré : ${r.file}. Suite : ceng adapt, ceng learn add.` : 'Incrément non clos : corriger les contrôles en échec.'].join('\n'), r);
  if (!r.ok) process.exitCode = 1;
}
