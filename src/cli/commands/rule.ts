import * as path from 'node:path';
import { addRule, listRules, removeRule } from '../../app/rules.js';
import { BrainStore } from '../../brain/store.js';
import { out, parse, requirePositional, requireStr, str, UsageError } from '../args.js';

/** `ceng rule add --pattern "<regex>" --message "…" [--glob "src/**"] | list | remove <R01>` : règles de contrôle du code propres au projet. */
export function ruleCommand(argv: string[]): void {
  const [sub, ...rest] = argv;
  const p = parse(rest, { dir: { type: 'string' }, pattern: { type: 'string' }, message: { type: 'string' }, glob: { type: 'string' } });
  const store = new BrainStore(path.resolve(str(p, 'dir') ?? process.cwd()));
  store.requireInitialized();
  switch (sub) {
    case 'add': {
      const r = addRule(store, { pattern: requireStr(p, 'pattern'), message: requireStr(p, 'message'), ...(str(p, 'glob') ? { glob: str(p, 'glob')! } : {}) });
      out(p, `${r.id} ajoutée : /${r.pattern}/${r.glob ? ` sur ${r.glob}` : ''} → ${r.message}`, r);
      return;
    }
    case 'list': {
      const rules = listRules(store);
      out(p, rules.map((r) => `${r.id} /${r.pattern}/${r.glob ? ` (${r.glob})` : ''} — ${r.message}`).join('\n') || 'Aucune règle de projet.', rules);
      return;
    }
    case 'remove':
      removeRule(store, requirePositional(p, 0, 'règle'));
      out(p, 'Règle retirée.', {});
      return;
    default:
      throw new UsageError('Usage : ceng rule add --pattern "<regex>" --message "…" [--glob "…"] | list | remove <R01>');
  }
}
