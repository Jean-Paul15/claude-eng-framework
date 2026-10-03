import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcile } from '../domain/policy.js';
import type { Preferences } from '../domain/types.js';
import { discover } from '../discovery/index.js';
import type { ProjectProfile } from '../discovery/profile.js';
import { exists, readJson, readText, sha256, writeJsonAtomic, writeTextAtomic, ensureDir } from '../infra/fs.js';
import { renderIndex } from '../brain/brief.js';
import { BrainPaths } from '../brain/paths.js';
import { BrainStore, SCHEMA_VERSION, type FrameworkConfig } from '../brain/store.js';
import { AGENTS, SKILLS, selectAssets } from './catalog.js';
import { architectureTemplate, OBJECTIVE_TEMPLATE, renderProjectMd } from './brain-docs.js';
import { renderBlock, upsertBlock } from './claudemd.js';
import { matchTemplates, renderProjectSkill, type ProjectSkillTemplate } from './project-skills.js';
import { mergeSettings, type ClaudeSettings } from './settings.js';

/**
 * Installation dans un projet cible. Principes :
 *  - ne jamais modifier le code du projet ; seulement `.ceng/`, `.claude/`, `CLAUDE.md`, `.gitignore` ;
 *  - sauvegarder avant de modifier un fichier existant ;
 *  - idempotent (relancer = mettre à jour) ; les fichiers modifiés par l'utilisateur sont préservés ;
 *  - n'installer que ce que le profil justifie.
 */

export interface FrameworkRoot {
  root: string;
  core: string;
  dist: string;
  version: string;
}

export function locateFramework(fromUrl = import.meta.url): FrameworkRoot | undefined {
  let dir = path.dirname(fileURLToPath(fromUrl));
  for (let i = 0; i < 5; i++) {
    if (exists(path.join(dir, 'core', 'skills')) && exists(path.join(dir, 'package.json'))) {
      const pkg = readJson<{ version: string }>(path.join(dir, 'package.json'));
      return { root: dir, core: path.join(dir, 'core'), dist: path.join(dir, 'dist', 'src'), version: pkg?.version ?? '0.0.0' };
    }
    dir = path.dirname(dir);
  }
  return undefined;
}

export interface Manifest {
  frameworkVersion: string;
  installedAt: string;
  files: Record<string, string>;
}

export interface InstallOptions {
  projectRoot: string;
  preferences: Preferences;
  goal?: string;
  dryRun?: boolean;
  profile?: ProjectProfile;
  interactiveTeamsPossible?: boolean;
  /** Activer le graphe de code graphify (défaut : conserver le choix précédent, sinon activé). */
  codeGraph?: boolean;
  /** Validations par l'invite de questions avec bascule automatique en mode sans humain (défaut : activé). */
  presence?: boolean;
}

export type ActionKind = 'create' | 'update' | 'keep-user-version' | 'skip' | 'backup';

export interface InstallAction {
  kind: ActionKind;
  path: string;
  why: string;
}

export interface InstallReport {
  profile: ProjectProfile;
  config: FrameworkConfig;
  actions: InstallAction[];
  skills: { installed: string[]; skipped: { name: string; why: string }[]; generated: string[] };
  agents: string[];
}

/** Écrit (ou simule) en suivant le manifeste : un fichier modifié par l'utilisateur n'est jamais écrasé. */
class ManagedWriter {
  readonly actions: InstallAction[] = [];
  readonly newManifest: Manifest;

  constructor(
    private readonly root: string,
    private readonly previous: Manifest | undefined,
    private readonly dryRun: boolean,
    version: string,
    private readonly conflictsDir: string,
  ) {
    this.newManifest = { frameworkVersion: version, installedAt: new Date().toISOString(), files: {} };
  }

  /** Fichier géré par le framework (skills, agents, runtime). */
  managed(rel: string, content: string | Buffer, why: string): void {
    const abs = path.join(this.root, rel);
    const hash = sha256(content);
    const current = exists(abs) ? fs.readFileSync(abs) : undefined;
    const previousHash = this.previous?.files[rel];
    if (current !== undefined) {
      const currentHash = sha256(current);
      if (currentHash === hash) {
        this.newManifest.files[rel] = hash;
        return;
      }
      const userOwned = previousHash === undefined || currentHash !== previousHash;
      if (userOwned) {
        // Fichier créé ou modifié par l'utilisateur : on le garde, la nouvelle version va à côté.
        this.actions.push({ kind: 'keep-user-version', path: rel, why: previousHash === undefined ? 'fichier existant non créé par ceng' : 'modifié localement depuis l\'installation' });
        if (!this.dryRun) writeBytes(path.join(this.conflictsDir, rel), content);
        if (previousHash) this.newManifest.files[rel] = previousHash;
        return;
      }
    }
    this.actions.push({ kind: current === undefined ? 'create' : 'update', path: rel, why });
    if (!this.dryRun) writeBytes(abs, content);
    this.newManifest.files[rel] = hash;
  }

  /** Fichier du Brain créé une seule fois (contenu ensuite propriété du projet). */
  once(rel: string, content: string, why: string): void {
    const abs = path.join(this.root, rel);
    if (exists(abs)) return;
    this.actions.push({ kind: 'create', path: rel, why });
    if (!this.dryRun) writeTextAtomic(abs, content);
  }

  /** Fichier régénéré à chaque init (config, profil, index), avec sauvegarde s'il s'agit d'un fichier utilisateur. */
  generated(rel: string, content: string, why: string): void {
    const abs = path.join(this.root, rel);
    const current = readText(abs);
    if (current === content) return;
    this.actions.push({ kind: current === undefined ? 'create' : 'update', path: rel, why });
    if (!this.dryRun) writeTextAtomic(abs, content);
  }

  backup(rel: string, backupDir: string): void {
    const abs = path.join(this.root, rel);
    if (!exists(abs)) return;
    this.actions.push({ kind: 'backup', path: rel, why: `copie dans ${path.relative(this.root, backupDir).replace(/\\/g, '/')}` });
    if (!this.dryRun) writeBytes(path.join(backupDir, rel), fs.readFileSync(abs));
  }
}

function writeBytes(abs: string, content: string | Buffer): void {
  ensureDir(path.dirname(abs));
  fs.writeFileSync(abs, content);
}

function walkFiles(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walkFiles(dir, r));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

const GITIGNORE_BLOCK = ['# claude-eng-framework (journaux et sauvegardes locales)', '.ceng/logs/', '.ceng/backups/', '.ceng/upgrade-conflicts/', '.ceng/brain/*.lock', 'graphify-out/'];

export function install(opts: InstallOptions): InstallReport {
  const fw = locateFramework();
  if (!fw) throw new Error('Impossible de localiser le cœur du framework (dossier core/). Réinstaller claude-eng-framework.');
  if (!exists(path.join(fw.dist, 'cli.js'))) throw new Error('Le framework n\'est pas compilé (dist/ absent) : lancer `npm run build` dans le dépôt du framework.');
  const root = path.resolve(opts.projectRoot);
  const paths = new BrainPaths(root);
  const profile = opts.profile ?? discover(root);
  const policy = reconcile(opts.preferences, {
    detectedRisk: profile.riskLevel,
    domains: profile.domains.map((d) => d.name),
    interactiveTeamsPossible: opts.interactiveTeamsPossible ?? true,
  });
  const previousManifest = readJson<Manifest>(paths.manifest);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const w = new ManagedWriter(root, previousManifest, opts.dryRun ?? false, fw.version, path.join(paths.ceng, 'upgrade-conflicts'));
  const backupDir = path.join(paths.backups, stamp);

  // 1. Sauvegardes des fichiers utilisateur que l'on va fusionner
  w.backup('.claude/settings.json', backupDir);
  w.backup('CLAUDE.md', backupDir);

  // 2. Runtime vendored (CLI + hooks, zéro dépendance) : fonctionne sans installation globale (CI, cloud, coéquipiers)
  for (const rel of walkFiles(fw.dist)) {
    if (!rel.endsWith('.js')) continue;
    w.managed(`.ceng/runtime/${rel}`, fs.readFileSync(path.join(fw.dist, rel)), 'runtime du framework');
  }
  w.managed('.ceng/runtime/package.json', '{\n  "type": "module",\n  "private": true\n}\n', 'modules ESM du runtime');

  // 3. Skills et agents sélectionnés
  const skillSel = selectAssets(SKILLS, profile);
  for (const s of skillSel.selected) {
    const dir = path.join(fw.core, 'skills', s.name);
    if (!exists(dir)) throw new Error(`Skill du cœur manquante : ${dir}`);
    for (const rel of walkFiles(dir)) w.managed(`.claude/skills/${s.name}/${rel}`, fs.readFileSync(path.join(dir, rel)), s.why);
  }
  const agentSel = selectAssets(AGENTS, profile);
  for (const a of agentSel.selected) w.managed(`.claude/agents/${a.name}.md`, fs.readFileSync(path.join(fw.core, 'agents', `${a.name}.md`)), a.why);

  // 4. Skills spécifiques au projet (brouillons, créés une seule fois)
  const templates = readJson<ProjectSkillTemplate[]>(path.join(fw.core, 'project-skills.json')) ?? [];
  const generated = matchTemplates(templates, profile);
  for (const t of generated) w.once(`.claude/skills/${t.name}/SKILL.md`, renderProjectSkill(t, profile, new Date().toISOString().slice(0, 10)), 'besoin spécifique détecté');

  // 5. Configuration et Brain
  const previousConfig = readJson<FrameworkConfig>(paths.config);
  const config: FrameworkConfig = {
    schemaVersion: SCHEMA_VERSION,
    frameworkVersion: fw.version,
    projectName: profile.name,
    preferences: opts.preferences,
    policy,
    // Les commandes ajustées à la main par l'utilisateur priment sur la détection.
    commands: { ...profile.commands, ...(previousConfig?.commands ?? {}) },
    gateTimeoutMinutes: previousConfig?.gateTimeoutMinutes ?? 15,
    codeGraph: { enabled: opts.codeGraph ?? previousConfig?.codeGraph?.enabled ?? true },
    presence: { enabled: opts.presence ?? previousConfig?.presence?.enabled ?? true },
    installedSkills: [...skillSel.selected.map((s) => s.name), ...generated.map((g) => g.name)],
    installedAgents: agentSel.selected.map((a) => a.name),
    createdAt: previousConfig?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  w.generated('.ceng/config.json', `${JSON.stringify(config, null, 2)}\n`, 'politique effective + commandes');
  w.generated('.ceng/profile.json', `${JSON.stringify(profile, null, 2)}\n`, 'profil découvert');
  w.generated('.ceng/brain/project.md', renderProjectMd(profile, policy), 'profil lisible');
  w.once('.ceng/brain/objective.md', opts.goal ? `# Objectif\n\n${opts.goal}\n` : OBJECTIVE_TEMPLATE, 'objectif du projet');
  w.once('.ceng/brain/architecture.md', architectureTemplate(profile), 'architecture');
  w.once('.ceng/brain/assumptions.md', '# Hypothèses\n\n_Chaque hypothèse : énoncé · date · tâche · comment la vérifier · statut._\n', 'hypothèses');
  w.once('.ceng/brain/known-issues.md', '# Problèmes connus\n\n_Problème · impact · contournement · tâche de correction._\n', 'problèmes connus');
  w.once('.ceng/brain/tasks.json', `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, tasks: [] }, null, 2)}\n`, 'graphe de tâches');
  for (const d of ['decisions', 'reports', 'escalations', 'research', 'teams']) w.once(`.ceng/brain/${d}/.gitkeep`, '', `répertoire ${d}`);

  // 6. Intégration Claude Code : settings.json (fusion), CLAUDE.md (bloc), .gitignore
  const settingsPath = path.join(root, '.claude', 'settings.json');
  const merged = mergeSettings(readJson<ClaudeSettings>(settingsPath), { autonomy: policy.autonomy, parallelism: policy.parallelism });
  w.generated('.claude/settings.json', `${JSON.stringify(merged, null, 2)}\n`, 'hooks + règles de permission (fusion non destructive)');
  w.generated('CLAUDE.md', upsertBlock(readText(path.join(root, 'CLAUDE.md')), renderBlock(profile, policy, config.codeGraph?.enabled ?? false)), 'bloc ceng (pointeurs compacts)');
  const gi = readText(path.join(root, '.gitignore')) ?? '';
  const giLines = new Set(gi.split(/\r?\n/).map((l) => l.trim()));
  const missing = GITIGNORE_BLOCK.slice(1).filter((l) => !giLines.has(l));
  if (missing.length) {
    const header = giLines.has(GITIGNORE_BLOCK[0]!) ? [] : [GITIGNORE_BLOCK[0]!];
    w.generated('.gitignore', `${gi.replace(/\s*$/, '')}${gi ? '\n\n' : ''}${[...header, ...missing].join('\n')}\n`, 'exclure journaux, sauvegardes et graphe local');
  }

  if (!opts.dryRun) {
    writeJsonAtomic(paths.manifest, w.newManifest);
    const store = new BrainStore(root);
    writeTextAtomic(paths.index, renderIndex(store));
    store.log({ type: 'session.start', data: { source: 'init', frameworkVersion: fw.version, riskLevel: policy.riskLevel, skills: config.installedSkills.length } });
  }
  return {
    profile,
    config,
    actions: w.actions,
    skills: {
      installed: skillSel.selected.map((s) => s.name),
      skipped: skillSel.skipped.map((s) => ({ name: s.name, why: 'non pertinent pour ce profil' })),
      generated: generated.map((g) => g.name),
    },
    agents: agentSel.selected.map((a) => a.name),
  };
}
