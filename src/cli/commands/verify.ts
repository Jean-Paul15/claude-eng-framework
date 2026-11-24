import * as path from 'node:path';
import { runShell, tail } from '../../infra/exec.js';
import { BrainStore } from '../../brain/store.js';
import { out, parse, str } from '../args.js';
import { redact } from '../../domain/secrets.js';

/**
 * `ceng verify` : vérification après déploiement (`commands.smoke` de .ceng/config.json : page d'accueil, point de santé, parcours
 * principal en lecture seule). Échec : annuler la mise en ligne (commande de retour arrière du fournisseur) et ouvrir une tâche `bug`.
 */
export function verifyCommand(argv: string[]): void {
  const p = parse(argv, { dir: { type: 'string' } });
  const store = new BrainStore(path.resolve(str(p, 'dir') ?? process.cwd()));
  store.requireInitialized();
  const cmd = (store.config().commands as Record<string, string | undefined>)['smoke'];
  if (!cmd) {
    out(p, "Aucune commande `smoke` : la définir dans .ceng/config.json → commands.smoke (ex. curl -fsS https://… /health && le parcours principal en lecture seule).", { ok: false, configured: false });
    process.exitCode = 1;
    return;
  }
  const r = runShell(cmd, { cwd: store.paths.root, timeoutMs: 5 * 60_000 });
  store.log({ type: 'gate.result', data: { gate: 'smoke', status: r.code === 0 ? 'pass' : 'fail', command: cmd.slice(0, 120) } });
  out(p, r.code === 0 ? `Vérification après déploiement : OK (${cmd}).` : `Vérification après déploiement : ÉCHEC (exit ${r.code}).\n${redact(tail(`${r.stdout}\n${r.stderr}`.trim(), 15))}\nAnnuler la mise en ligne (retour arrière du fournisseur) puis \`task add --kind bug\` en priorité.`, { ok: r.code === 0, code: r.code });
  if (r.code !== 0) process.exitCode = 1;
}
