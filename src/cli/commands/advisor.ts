import * as path from 'node:path';
import { advisorOutranks, isAdvisorModel } from '../../domain/advisor.js';
import { BrainStore } from '../../brain/store.js';
import { out, parse, str, UsageError } from '../args.js';

/**
 * `ceng advisor [status|fable|opus|sonnet|<identifiant>|off]` — conseiller de Claude Code pour ce projet (lancé par `ceng run`
 * avec `--advisor`). Décision de l'humain : un conseiller fort coûte des jetons (Fable peut se facturer en crédits d'usage).
 * Pour la session déjà ouverte : `/advisor <modèle>` dans Claude Code.
 */
export function advisorCommand(argv: string[]): void {
  const [sub, ...rest] = argv;
  const p = parse(rest, { dir: { type: 'string' } });
  const store = new BrainStore(path.resolve(str(p, 'dir') ?? process.cwd()));
  store.requireInitialized();
  const config = store.config();
  const current = config.advisor?.model;
  if (!sub || sub === 'status') {
    out(p, current ? `Conseiller : ${current} (lancé avec --advisor par \`ceng run\` ; dans une session ouverte : /advisor ${current}).` : 'Conseiller : aucun. Activer : ceng advisor fable|opus|sonnet', { advisor: current ?? null });
    return;
  }
  if (sub === 'off') {
    const { advisor: _removed, ...rest2 } = config;
    store.saveConfig(rest2);
    out(p, 'Conseiller désactivé pour ce projet.', { advisor: null });
    return;
  }
  if (!isAdvisorModel(sub)) throw new UsageError('Usage : ceng advisor status | fable | opus | sonnet | <identifiant complet> | off');
  store.saveConfig({ ...config, advisor: { model: sub } });
  const main = config.policy.orchestratorModel;
  const warn = advisorOutranks(sub, main) ? '' : ` Attention : le conseiller doit se classer au moins au niveau du modèle principal (${main}) : sinon Claude Code ne l'attache pas.`;
  out(p, `Conseiller : ${sub}.${warn} Prochain \`ceng run\` : --advisor ${sub}. Session ouverte : /advisor ${sub}. Fable exige l'accès Fable et peut se facturer en crédits d'usage.`, { advisor: sub });
}
