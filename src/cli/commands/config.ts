import * as path from 'node:path';
import { applyCommands, diffCommands, hasChanges, type CommandChange, type CommandRow } from '../../app/commands-config.js';
import { BrainStore } from '../../brain/store.js';
import { CLI_INVOCATION } from '../../brain/paths.js';
import { discover } from '../../discovery/index.js';
import { exists } from '../../infra/fs.js';
import { bool, out, parse, str, UsageError } from '../args.js';
import type { Stage } from '../../domain/types.js';

const LABEL: Record<CommandChange, string> = { unchanged: '=', added: '+ nouvelle', changed: '~ modifiée', kept: '· conservée' };

function render(root: string, rows: readonly CommandRow[]): string {
  const width = Math.max(...rows.map((r) => r.gate.length), 4);
  const lines = rows.map((r) => {
    const value = r.recommended ?? r.current ?? '';
    const was = r.change === 'changed' ? `   (était : ${r.current})` : '';
    return `  ${r.gate.padEnd(width)}  ${LABEL[r.change].padEnd(12)} ${value}${was}`;
  });
  return [`Commandes de gates recommandées pour ${root} (déduites de la pile réelle ; lancées depuis la racine) :`, '', ...lines].join('\n');
}

/**
 * `config detect` : affiche les commandes recommandées pour le projet courant.
 * `--apply` les écrit dans `.ceng/config.json` — fichier de garde-fous : le hook de garde exige la validation de l'humain.
 */
export function configCommand(argv: string[]): void {
  const [sub, ...rest] = argv;
  if (sub === 'stage') return stageCommand(rest);
  if (sub !== 'detect') throw new UsageError('Usage : ceng config detect [--apply] | ceng config stage [prototype|production] [--dir <projet>]');
  const p = parse(rest, { dir: { type: 'string' }, apply: { type: 'boolean' } });
  const root = path.resolve(str(p, 'dir') ?? process.cwd());
  if (!exists(root)) throw new UsageError(`Répertoire introuvable : ${root}`);
  const store = new BrainStore(root);
  const initialized = store.isInitialized();
  if (bool(p, 'apply') && !initialized) throw new UsageError('Projet non initialisé : utiliser `ceng init` (rien à écrire).');
  const recommended = discover(root).commands;
  const rows = diffCommands(initialized ? store.config().commands : {}, recommended);
  const changed = hasChanges(rows);
  let applied = false;
  if (bool(p, 'apply') && changed) {
    applyCommands(store, recommended);
    applied = true;
  }
  const hint = applied
    ? '\n\nÉcrit dans .ceng/config.json.'
    : !changed
      ? '\n\nConfiguration déjà à jour.'
      : initialized
        ? `\n\nPour l'appliquer : \`${CLI_INVOCATION} config detect --apply\` (écrit .ceng/config.json : validation humaine requise).`
        : '\n\nProjet non initialisé : ces commandes seront utilisées par `ceng init`.';
  out(p, rows.length ? render(root, rows) + hint : `Aucune commande détectée pour ${root}.`, { root, applied, commands: recommended, rows });
}

const STAGE_TEXT: Record<Stage, string> = {
  prototype: 'prototype — aucun utilisateur réel : migrations, déploiements, suppressions (instantané avant), push et fichiers de garde-fous sans validation ; restent soumis à l\'humain : secrets, suppression hors du dépôt, push forcé sur une branche protégée d\'un dépôt partagé, publication, infrastructure',
  production: 'production — garde-fous complets : validation humaine des actions à risque',
};

/**
 * `config stage` : affiche le stade du projet ; `config stage prototype|production` le change dans .ceng/config.json.
 * Changer le stade change le niveau des garde-fous : le hook exige la validation de l'humain quand c'est Claude qui le demande.
 */
function stageCommand(argv: string[]): void {
  const p = parse(argv, { dir: { type: 'string' } });
  const root = path.resolve(str(p, 'dir') ?? process.cwd());
  const store = new BrainStore(root);
  if (!store.isInitialized()) throw new UsageError('Projet non initialisé : utiliser `ceng init`.');
  const config = store.config();
  const current: Stage = config.stage ?? 'production';
  const wanted = p.positionals[0];
  if (wanted === undefined) {
    out(p, `Stade : ${STAGE_TEXT[current]}`, { stage: current });
    return;
  }
  if (wanted !== 'prototype' && wanted !== 'production') throw new UsageError('Stade : prototype|production.');
  if (wanted !== current) store.saveConfig({ ...config, stage: wanted });
  out(p, wanted === current ? `Stade déjà : ${STAGE_TEXT[wanted]}` : `Stade : ${STAGE_TEXT[wanted]}\n(\`ceng upgrade\` régénère le bloc CLAUDE.md du projet.)`, { stage: wanted, changed: wanted !== current });
}
