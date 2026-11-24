import * as path from 'node:path';
import { checkStore } from '../../domain/store-check.js';
import { parseManifest } from '../../domain/deps.js';
import { exists, listFiles, readText } from '../../infra/fs.js';
import { out, parse, str, UsageError } from '../args.js';

/**
 * `ceng store check` : motifs de rejet Apple détectables dans un projet Flutter (permissions sans texte, connexion Apple absente,
 * suppression de compte, manifeste de confidentialité). Code de sortie 1 s'il reste un point bloquant.
 */
export function storeCommand(argv: string[]): void {
  const [sub, ...rest] = argv;
  if (sub !== 'check') throw new UsageError('Usage : ceng store check [--dir <projet>]');
  const p = parse(rest, { dir: { type: 'string' } });
  const root = path.resolve(str(p, 'dir') ?? process.cwd());
  const files = listFiles(root, { maxDepth: 3, maxFiles: 20000 }).files;
  const pubspec = files.find((f) => /(^|\/)pubspec\.yaml$/.test(f) && exists(path.join(root, path.posix.dirname(f), 'ios')));
  if (!pubspec) {
    out(p, 'Projet iOS non détecté (pubspec.yaml avec un dossier ios/) : rien à contrôler.', { findings: [] });
    return;
  }
  const app = path.posix.dirname(pubspec);
  const deps = new Set(parseManifest(pubspec, readText(path.join(root, pubspec)) ?? '').map((d) => d.name));
  const plist = readText(path.join(root, app, 'ios', 'Runner', 'Info.plist'));
  const hasPrivacyManifest = files.some((f) => f.startsWith(app === '.' ? 'ios/' : `${app}/ios/`) && /PrivacyInfo\.xcprivacy$/.test(f));
  const code = files.filter((f) => f.startsWith(app === '.' ? 'lib/' : `${app}/lib/`) && f.endsWith('.dart')).map((f) => readText(path.join(root, f)) ?? '').join('\n');
  const findings = checkStore({ deps, plist, hasPrivacyManifest, code });
  const blocking = findings.filter((f) => f.level === 'blocking');
  out(p, findings.length
    ? [...findings.map((f) => `${f.level === 'blocking' ? '✖ BLOQUANT' : '? à confirmer'} [${f.guideline}] ${f.message}`), '', blocking.length ? 'Corriger les points bloquants avant la soumission ; relire les règles à jour (skill ios-release § 0).' : 'Points à confirmer avec l\'humain.'].join('\n')
    : 'Aucun motif de rejet détectable dans le code (le test visuel « premier lancement sans compte » reste obligatoire : 5.1.1(v)).', { findings });
  if (blocking.length) process.exitCode = 1;
}
