import * as path from 'node:path';
import { isSecretPath } from '../../domain/guardrails.js';
import { normalizePath } from '../../domain/globs.js';
import { mergeSettings, type ClaudeSettings } from '../../generation/settings.js';
import { readJson, readText, writeJsonAtomic } from '../../infra/fs.js';
import { BrainStore } from '../../brain/store.js';
import { bool, out, parse, requirePositional, str, UsageError } from '../args.js';

/**
 * `ceng secrets allow|revoke|list` — fichiers de secrets que l'humain autorise l'agent à utiliser.
 * Autoriser est une action humaine : la garde de commandes la soumet à l'approbation (l'agent ne peut pas se
 * l'accorder). Les valeurs lues entrent dans le contexte du modèle : à réserver aux clés de test / développement.
 */
const PRODUCTION_HINT = /(^|[./_-])(prod|production|live)([./_-]|$)/i;

function refreshSettings(store: BrainStore, allow: string[]): void {
  const config = store.config();
  const settingsPath = path.join(store.paths.root, '.claude', 'settings.json');
  const merged = mergeSettings(readJson<ClaudeSettings>(settingsPath), { autonomy: config.policy.autonomy, parallelism: config.policy.parallelism, allowedSecrets: allow });
  writeJsonAtomic(settingsPath, merged);
}

export function secretsCommand(argv: string[]): void {
  const [sub, ...rest] = argv;
  const p = parse(rest, { dir: { type: 'string' }, 'i-understand-production': { type: 'boolean' } });
  const store = new BrainStore(path.resolve(str(p, 'dir') ?? process.cwd()));
  store.requireInitialized();
  const config = store.config();
  const allow = [...(config.secrets?.allow ?? [])];
  switch (sub ?? 'list') {
    case 'list': {
      out(p, allow.length ? `Secrets autorisés :\n${allow.map((a) => `  - ${a}`).join('\n')}` : 'Aucun fichier de secrets autorisé.', allow);
      return;
    }
    case 'allow': {
      const file = normalizePath(requirePositional(p, 0, 'fichier'));
      if (file.startsWith('..') || path.isAbsolute(file)) throw new UsageError('Seuls des fichiers du projet peuvent être autorisés (chemin relatif).');
      if (!isSecretPath(file)) throw new UsageError(`${file} n'est pas un fichier de secrets protégé : rien à autoriser.`);
      if (PRODUCTION_HINT.test(file) && !bool(p, 'i-understand-production')) {
        throw new UsageError(`${file} ressemble à des secrets de PRODUCTION. Leur contenu entrerait dans le contexte du modèle. Préférer des clés de test ; sinon relancer avec --i-understand-production.`);
      }
      if (!allow.includes(file)) allow.push(file);
      store.saveConfig({ ...config, secrets: { allow } });
      refreshSettings(store, allow);
      store.log({ type: 'guard.verdict', data: { class: 'secret-allowed', file } });
      out(p, `${file} autorisé. Son contenu entrera dans le contexte du modèle quand Claude le lira ; les journaux du framework restent masqués et le fichier ne doit pas être commité. Révocable : ceng secrets revoke ${file}`, { allow });
      return;
    }
    case 'keys': {
      // Utiliser les secrets sans les voir : seuls les NOMS des variables et leur état sont montrés, jamais les valeurs.
      const file = normalizePath(requirePositional(p, 0, 'fichier'));
      if (file.startsWith('..') || path.isAbsolute(file)) throw new UsageError('Fichier du projet uniquement (chemin relatif).');
      const text = readText(path.join(store.paths.root, file));
      if (text === undefined) throw new UsageError(`${file} introuvable.`);
      const keys = text.split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => l.replace(/^export\s+/, '').match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => ({ name: m[1]!, defined: m[2]!.replace(/^["']|["']$/g, '').trim().length > 0 }));
      out(p, keys.length ? keys.map((k) => `${k.name} : ${k.defined ? 'définie' : 'vide'}`).join('\n') : 'Aucune variable.', keys);
      return;
    }
    case 'revoke': {
      const file = normalizePath(requirePositional(p, 0, 'fichier'));
      const next = allow.filter((a) => a !== file);
      store.saveConfig({ ...config, secrets: { allow: next } });
      refreshSettings(store, next);
      store.log({ type: 'guard.verdict', data: { class: 'secret-revoked', file } });
      out(p, `${file} n'est plus autorisé.`, { allow: next });
      return;
    }
    default:
      throw new UsageError('ceng secrets list | keys <fichier> | allow <fichier> | revoke <fichier>');
  }
}
