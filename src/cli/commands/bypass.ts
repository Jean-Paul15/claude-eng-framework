import * as path from 'node:path';
import { BrainStore } from '../../brain/store.js';
import { CLI_INVOCATION } from '../../brain/paths.js';
import { renderBlock, upsertBlock } from '../../generation/claudemd.js';
import { mergeSettings, type ClaudeSettings } from '../../generation/settings.js';
import { readJson, readText, writeJsonAtomic, writeTextAtomic } from '../../infra/fs.js';
import { out, parse, str, UsageError } from '../args.js';

/**
 * `ceng bypass on|off|status` — bypass total : le framework ne demande et ne refuse plus rien, et Claude Code passe en
 * `bypassPermissions`. Décision humaine : quand c'est Claude qui lance la commande, la garde la soumet à l'approbation.
 * Ce qui reste : le journal, les instantanés automatiques avant suppression/reset et le verrou de fichiers entre agents parallèles.
 */
export function bypassCommand(argv: string[]): void {
  const [sub, ...rest] = argv;
  const p = parse(rest, { dir: { type: 'string' } });
  const store = new BrainStore(path.resolve(str(p, 'dir') ?? process.cwd()));
  store.requireInitialized();
  const config = store.config();
  const current = config.bypass?.enabled === true;
  switch (sub ?? 'status') {
    case 'status':
      out(p, current ? `Bypass total : ACTIVÉ depuis ${config.bypass?.since ?? '?'}. Retour aux garde-fous : ${CLI_INVOCATION} bypass off` : 'Bypass total : désactivé (garde-fous selon le stade du projet).', { bypass: config.bypass ?? { enabled: false } });
      return;
    case 'on':
    case 'off': {
      const enabled = sub === 'on';
      const bypass = enabled ? { enabled, since: current ? (config.bypass?.since ?? new Date().toISOString()) : new Date().toISOString() } : { enabled: false };
      store.saveConfig({ ...config, bypass });
      refreshClaudeFiles(store);
      store.log({ type: 'guard.verdict', data: { class: 'bypass-mode', enabled } });
      out(p, enabled
        ? 'Bypass total ACTIVÉ. Claude agit sans aucune validation (suppressions, push, déploiements, migrations, .env, garde-fous). Tout est journalisé ; instantané avant suppression/reset. Ouvrir une NOUVELLE session pour que Claude Code prenne le mode bypassPermissions.'
        : 'Bypass total désactivé : garde-fous rétablis (nouvelle session pour que Claude Code recharge ses permissions).', { bypass });
      return;
    }
    default:
      throw new UsageError('Usage : ceng bypass status|on|off [--dir <projet>]');
  }
}

/** Réécrit .claude/settings.json et le bloc CLAUDE.md pour refléter le mode courant. */
function refreshClaudeFiles(store: BrainStore): void {
  const config = store.config();
  const root = store.paths.root;
  const settingsPath = path.join(root, '.claude', 'settings.json');
  writeJsonAtomic(settingsPath, mergeSettings(readJson<ClaudeSettings>(settingsPath), {
    autonomy: config.policy.autonomy, parallelism: config.policy.parallelism, allowedSecrets: config.secrets?.allow ?? [], bypass: config.bypass?.enabled === true, testsWatch: config.testsWatch?.enabled === true,
  }));
  const profile = store.profile();
  if (!profile) return;
  const claudeMd = path.join(root, 'CLAUDE.md');
  writeTextAtomic(claudeMd, upsertBlock(readText(claudeMd), renderBlock(profile, config.policy, config.codeGraph?.enabled ?? false, config.stage, config.bypass?.enabled === true)));
}
