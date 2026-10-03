import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_PREFERENCES } from '../../domain/policy.js';
import type { Preferences } from '../../domain/types.js';
import { discover } from '../../discovery/index.js';
import type { ProjectProfile } from '../../discovery/profile.js';
import { install, locateFramework, type InstallReport, type Manifest } from '../../generation/install.js';
import { removeBlock } from '../../generation/claudemd.js';
import { stripFramework, type ClaudeSettings } from '../../generation/settings.js';
import { exists, readJson, readText, sha256, writeJsonAtomic, writeTextAtomic } from '../../infra/fs.js';
import { run } from '../../infra/exec.js';
import { Prompter, type Choice } from '../../infra/prompt.js';
import { BrainStore } from '../../brain/store.js';
import { graphDisabledByEnv, graphifyAvailable } from '../../app/codegraph.js';
import { graphEnabledFlag, setupGraphAtInit } from './graph.js';
import { bool, out, parse, str, UsageError, type Parsed } from '../args.js';

const PREF_FLAGS = {
  'project-type': { type: 'string' }, risk: { type: 'string' }, autonomy: { type: 'string' }, budget: { type: 'string' },
  quality: { type: 'string' }, testing: { type: 'string' }, security: { type: 'string' }, parallelism: { type: 'string' },
  'max-parallel': { type: 'string' }, 'model-strategy': { type: 'string' }, deployment: { type: 'string' },
  research: { type: 'string' }, review: { type: 'string' },
} as const;

type Q<K extends keyof Preferences> = { key: K; flag: string; question: string; hint?: string; choices: Choice<Extract<Preferences[K], string>>[] };

const QUESTIONS: Q<keyof Preferences>[] = [
  { key: 'riskLevel', flag: 'risk', question: 'Niveau de risque du projet', choices: [
    { value: 'low', label: 'low — prototype, outil interne' }, { value: 'medium', label: 'medium — produit standard' },
    { value: 'high', label: 'high — données personnelles, auth, multi-tenant' }, { value: 'critical', label: 'critical — argent, santé, infra de production' }] },
  { key: 'autonomy', flag: 'autonomy', question: 'Niveau d\'autonomie', hint: 'Les actions irréversibles restent soumises à approbation humaine dans tous les cas.', choices: [
    { value: 'supervised', label: 'supervised — validation des push et actions à risque ≥ 4' }, { value: 'balanced', label: 'balanced — autonome sur le code, validation des actions à risque' },
    { value: 'high', label: 'high — autonome y compris CI/infra-as-code (hors actions irréversibles)' }] },
  { key: 'budget', flag: 'budget', question: 'Préférence de budget (tokens)', choices: [
    { value: 'economy', label: 'economy — seuils hauts avant Opus, effort réduit hors domaines critiques' }, { value: 'balanced', label: 'balanced' },
    { value: 'quality', label: 'quality — Opus plus tôt, effort accru' }] },
  { key: 'quality', flag: 'quality', question: 'Niveau de qualité attendu', choices: [
    { value: 'light', label: 'light — prototype' }, { value: 'standard', label: 'standard' }, { value: 'thorough', label: 'thorough — produit exigeant' }] },
  { key: 'testingDepth', flag: 'testing', question: 'Profondeur des tests', choices: [
    { value: 'light', label: 'light' }, { value: 'standard', label: 'standard' }, { value: 'thorough', label: 'thorough — e2e, propriétés, visuel' }] },
  { key: 'securityDepth', flag: 'security', question: 'Profondeur sécurité', choices: [
    { value: 'light', label: 'light' }, { value: 'standard', label: 'standard' }, { value: 'thorough', label: 'thorough — audit de dépendances systématique' }] },
  { key: 'parallelism', flag: 'parallelism', question: 'Parallélisme', hint: 'Agent Teams = expérimental, sessions interactives, plus coûteux ; utilisé seulement si le planner le justifie.', choices: [
    { value: 'off', label: 'off — séquentiel' }, { value: 'subagents', label: 'subagents — parallèle quand les tâches sont indépendantes' },
    { value: 'teams', label: 'teams — autoriser aussi les Agent Teams' }] },
  { key: 'modelStrategy', flag: 'model-strategy', question: 'Stratégie de modèles', choices: [
    { value: 'adaptive', label: 'adaptive — le framework choisit l\'orchestrateur selon le risque' }, { value: 'opus-orchestrator', label: 'opus-orchestrator — Opus coordonne, les workers codent' },
    { value: 'sonnet-orchestrator', label: 'sonnet-orchestrator — Sonnet coordonne, escalade vers Opus' }] },
  { key: 'deployment', flag: 'deployment', question: 'Permissions de déploiement', choices: [
    { value: 'none', label: 'none — jamais de déploiement par l\'agent' }, { value: 'staging', label: 'staging — préproduction avec approbation' },
    { value: 'production-with-approval', label: 'production-with-approval — toujours avec approbation humaine' }] },
  { key: 'researchPolicy', flag: 'research', question: 'Politique de recherche externe', choices: [
    { value: 'minimal', label: 'minimal' }, { value: 'when-needed', label: 'when-needed — API récentes, nouveautés, vulnérabilités' }, { value: 'proactive', label: 'proactive' }] },
  { key: 'reviewPolicy', flag: 'review', question: 'Politique de revue', choices: [
    { value: 'minimal', label: 'minimal (hors domaines critiques)' }, { value: 'adaptive', label: 'adaptive — proportionnée au risque' }, { value: 'always', label: 'always — au moins une revue ciblée' }] },
];

function defaultsFor(profile: ProjectProfile, previous?: Preferences): Preferences {
  if (previous) return previous;
  return {
    ...DEFAULT_PREFERENCES,
    projectType: profile.projectTypes.join('+'),
    riskLevel: profile.riskLevel,
    quality: profile.riskLevel === 'low' ? 'light' : 'standard',
    securityDepth: profile.riskLevel === 'critical' ? 'thorough' : 'standard',
  };
}

function applyFlags(prefs: Preferences, p: Parsed): Preferences {
  const next = { ...prefs } as Record<string, unknown>;
  for (const q of QUESTIONS) {
    const v = str(p, q.flag);
    if (v === undefined) continue;
    if (!q.choices.some((c) => c.value === v)) throw new UsageError(`--${q.flag} invalide « ${v} » (valeurs : ${q.choices.map((c) => c.value).join(', ')}).`);
    next[q.key] = v;
  }
  const mp = str(p, 'max-parallel');
  if (mp !== undefined) {
    const n = Number.parseInt(mp, 10);
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new UsageError('--max-parallel doit être entre 1 et 10.');
    next['maxParallel'] = n;
  }
  const pt = str(p, 'project-type');
  if (pt) next['projectType'] = pt;
  return next as unknown as Preferences;
}

function summarize(report: InstallReport, dryRun: boolean): string {
  const p = report.profile;
  const c = report.config;
  const lines = [
    `${dryRun ? '[dry-run] ' : ''}Projet « ${p.name} » — ${p.projectTypes.join(', ')} · ${p.primaryLanguage ?? '?'} · ${p.frameworks.slice(0, 8).join(', ') || 'sans framework'}`,
    `Risque détecté : ${p.riskLevel}${p.domains.length ? ` (${p.domains.map((d) => d.name).join(', ')})` : ''} → politique : risque ${c.policy.riskLevel}, budget ${c.policy.budget}, autonomie ${c.policy.autonomy}, orchestrateur ${c.policy.orchestratorModel}`,
    ...(c.policy.notes.length ? ['', 'Recommandations / ajustements :', ...c.policy.notes.map((n) => `  • ${n}`)] : []),
    '',
    `Skills installées (${report.skills.installed.length}) : ${report.skills.installed.join(', ')}`,
    `Skills écartées (non pertinentes) : ${report.skills.skipped.map((s) => s.name).join(', ') || 'aucune'}`,
    `Skills projet générées (brouillons à compléter) : ${report.skills.generated.join(', ') || 'aucune'}`,
    `Agents : ${report.agents.join(', ')}`,
    `Gates avec commande détectée : ${Object.entries(c.commands).filter(([, v]) => v).map(([k]) => k).join(', ') || 'aucune'}`,
    '',
    `Fichiers (${report.actions.length}) :`,
    ...summarizeActions(report),
  ];
  return lines.join('\n');
}

function summarizeActions(report: InstallReport): string[] {
  const runtime = report.actions.filter((a) => a.path.startsWith('.ceng/runtime/'));
  const rest = report.actions.filter((a) => !a.path.startsWith('.ceng/runtime/'));
  const out = rest.map((a) => `  ${a.kind.padEnd(17)} ${a.path}${a.kind === 'keep-user-version' || a.kind === 'backup' ? ` (${a.why})` : ''}`);
  if (runtime.length) out.push(`  ${'runtime'.padEnd(17)} .ceng/runtime/ (${runtime.length} fichiers)`);
  return out;
}

export async function initCommand(argv: string[], mode: 'init' | 'upgrade' = 'init'): Promise<void> {
  const p = parse(argv, { yes: { type: 'boolean', short: 'y' }, 'dry-run': { type: 'boolean' }, goal: { type: 'string' }, dir: { type: 'string' }, 'code-graph': { type: 'string' }, 'install-graphify': { type: 'boolean' }, presence: { type: 'string' }, ...PREF_FLAGS });
  if (bool(p, 'help')) {
    process.stdout.write(`ceng ${mode} [--dir <projet>] [--yes] [--dry-run] [--goal "…"] [--risk …] [--autonomy …] [--budget …] [--parallelism …] …\n`);
    return;
  }
  const root = path.resolve(str(p, 'dir') ?? process.cwd());
  if (!exists(root)) throw new UsageError(`Répertoire introuvable : ${root}`);
  const store = new BrainStore(root);
  if (mode === 'upgrade' && !store.isInitialized()) throw new UsageError('Projet non initialisé : utiliser `ceng init`.');
  const previous = store.isInitialized() ? store.config().preferences : undefined;
  process.stderr.write(`Analyse de ${root}…\n`);
  const profile = discover(root);
  let prefs = applyFlags(defaultsFor(profile, previous), p);
  const interactive = mode === 'init' && !bool(p, 'yes') && !bool(p, 'json') && process.stdin.isTTY === true;
  if (interactive) {
    process.stdout.write(`\nDétecté : ${profile.projectTypes.join(', ')} · ${profile.primaryLanguage ?? '?'} · ${profile.frameworks.slice(0, 6).join(', ') || '—'} · risque ${profile.riskLevel}${profile.domains.length ? ` (${profile.domains.map((d) => d.name).join(', ')})` : ''}\n`);
    process.stdout.write('Ces préférences sont un point de départ : l\'orchestrateur peut recommander autre chose et l\'expliquera.\n');
    const prompter = new Prompter();
    try {
      const next = { ...prefs } as Record<string, unknown>;
      for (const q of QUESTIONS) {
        if (str(p, q.flag) !== undefined) continue;
        next[q.key] = await prompter.choose(q.question, q.choices, prefs[q.key] as never, q.hint);
      }
      prefs = next as unknown as Preferences;
      if (!str(p, 'goal')) {
        const goal = await prompter.text('Objectif du projet en une phrase (optionnel, détaillable plus tard avec Claude)');
        if (goal) p.values['goal'] = goal;
      }
    } finally {
      prompter.close();
    }
  }
  let codeGraph = graphEnabledFlag(str(p, 'code-graph'));
  let installGraph = bool(p, 'install-graphify');
  if (interactive && codeGraph !== false && !graphDisabledByEnv() && !graphifyAvailable(root)) {
    const prompter = new Prompter();
    try {
      installGraph = await prompter.confirm('Installer graphify (paquet Python graphifyy) pour un graphe de code construit et mis à jour automatiquement, sans coût IA ?', true);
      if (!installGraph) codeGraph = false;
    } finally {
      prompter.close();
    }
  }
  const goal = str(p, 'goal');
  const presenceRaw = str(p, 'presence');
  if (presenceRaw !== undefined && !['on', 'off'].includes(presenceRaw)) throw new UsageError('--presence : on|off');
  const report = install({ projectRoot: root, preferences: prefs, ...(goal ? { goal } : {}), dryRun: bool(p, 'dry-run'), profile, ...(codeGraph !== undefined ? { codeGraph } : {}), ...(presenceRaw !== undefined ? { presence: presenceRaw === 'on' } : {}) });
  const graphNotes = setupGraphAtInit(root, { enabled: report.config.codeGraph?.enabled ?? false, install: installGraph, dryRun: bool(p, 'dry-run') });
  const next = bool(p, 'dry-run') ? '' : `\n\nÉtape suivante : \`ceng run\` (ou ouvrir Claude Code dans ce dossier et taper /ceng-orchestrate).`;
  const graphText = graphNotes.length ? `\n\nGraphe de code :\n${graphNotes.map((n) => `  • ${n}`).join('\n')}` : '';
  out(p, summarize(report, bool(p, 'dry-run')) + graphText + next, { ...report, graphNotes });
}

export function profileCommand(argv: string[]): void {
  const p = parse(argv, { dir: { type: 'string' } });
  const profile = discover(path.resolve(str(p, 'dir') ?? process.cwd()));
  out(p, JSON.stringify(profile, null, 2), profile);
}

export function doctorCommand(argv: string[]): void {
  const p = parse(argv, { dir: { type: 'string' } });
  const root = path.resolve(str(p, 'dir') ?? process.cwd());
  const store = new BrainStore(root);
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0]!, 10);
  add('node', nodeMajor >= 22, `Node ${process.versions.node} (≥ 22 requis)`);
  const claude = run(process.platform === 'win32' ? 'where' : 'which', ['claude'], { cwd: root, timeoutMs: 5000 });
  add('claude', claude.code === 0, claude.code === 0 ? claude.stdout.split(/\r?\n/)[0]! : 'Claude Code introuvable dans le PATH');
  add('git', run('git', ['--version'], { cwd: root, timeoutMs: 5000 }).code === 0, 'git disponible');
  add('initialisé', store.isInitialized(), store.isInitialized() ? '.ceng/config.json présent' : 'lancer `ceng init`');
  if (store.isInitialized()) {
    const config = store.config();
    add('runtime', exists(path.join(store.paths.runtime, 'cli.js')) && exists(path.join(store.paths.runtime, 'hooks', 'run.js')), '.ceng/runtime/{cli.js,hooks/run.js}');
    const settings = readJson<ClaudeSettings>(path.join(root, '.claude', 'settings.json'));
    const hooked = JSON.stringify(settings?.hooks ?? {}).includes('.ceng/runtime/hooks/run.js');
    add('hooks', hooked, hooked ? 'hooks ceng déclarés dans .claude/settings.json' : 'hooks absents : relancer `ceng upgrade`');
    add('CLAUDE.md', (readText(path.join(root, 'CLAUDE.md')) ?? '').includes('ceng:begin'), 'bloc ceng présent');
    const missingSkills = config.installedSkills.filter((s) => !exists(path.join(root, '.claude', 'skills', s, 'SKILL.md')));
    add('skills', missingSkills.length === 0, missingSkills.length ? `manquantes : ${missingSkills.join(', ')}` : `${config.installedSkills.length} installées`);
    const fw = locateFramework();
    const manifest = readJson<Manifest>(store.paths.manifest);
    if (fw && manifest) add('version', manifest.frameworkVersion === fw.version, `projet ${manifest.frameworkVersion} / framework ${fw.version}${manifest.frameworkVersion !== fw.version ? ' → `ceng upgrade`' : ''}`);
    const teams = settings?.env?.['CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'] === '1';
    add('agent-teams', config.policy.parallelism !== 'teams' || teams, config.policy.parallelism === 'teams' ? (teams ? 'activées' : 'demandées mais variable absente') : 'non utilisées (politique)');
    if (config.codeGraph?.enabled) {
      const has = graphifyAvailable(root);
      add('graphify', has, has ? (exists(path.join(root, 'graphify-out', 'graph.json')) ? 'graphe présent, mis à jour automatiquement' : 'installé ; graphe pas encore construit → `ceng graph build`') : 'graphe activé mais graphify absent → `ceng graph install`');
    }
    const gitignore = readText(path.join(root, '.gitignore')) ?? '';
    add('gitignore', gitignore.includes('.ceng/logs/'), '.ceng/logs/ exclu du dépôt');
  }
  const human = checks.map((c) => `${c.ok ? '✔' : '✖'} ${c.name.padEnd(12)} ${c.detail}`).join('\n');
  out(p, human, checks);
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}

/** Désinstallation propre : retire hooks, règles, bloc CLAUDE.md et fichiers gérés non modifiés. Le Brain est conservé sauf --purge. */
export function uninstallCommand(argv: string[]): void {
  const p = parse(argv, { dir: { type: 'string' }, purge: { type: 'boolean' }, yes: { type: 'boolean', short: 'y' } });
  const root = path.resolve(str(p, 'dir') ?? process.cwd());
  const store = new BrainStore(root);
  if (!store.isInitialized()) throw new UsageError('Rien à désinstaller.');
  if (!bool(p, 'yes')) throw new UsageError('Confirmer avec --yes (le Project Brain est conservé ; --purge le supprime aussi).');
  const manifest = readJson<Manifest>(store.paths.manifest);
  const removed: string[] = [];
  const kept: string[] = [];
  for (const [rel, hash] of Object.entries(manifest?.files ?? {})) {
    const abs = path.join(root, rel);
    if (!exists(abs)) continue;
    const current = fs.readFileSync(abs);
    if ((rel.startsWith('.claude/') && sha256(current) !== hash)) {
      kept.push(rel);
      continue;
    }
    fs.rmSync(abs, { force: true });
    removed.push(rel);
  }
  const settingsPath = path.join(root, '.claude', 'settings.json');
  const settings = readJson<ClaudeSettings>(settingsPath);
  if (settings) writeJsonAtomic(settingsPath, stripFramework(settings));
  const claudeMd = readText(path.join(root, 'CLAUDE.md'));
  if (claudeMd) writeTextAtomic(path.join(root, 'CLAUDE.md'), removeBlock(claudeMd));
  if (bool(p, 'purge')) fs.rmSync(store.paths.ceng, { recursive: true, force: true });
  out(p, `Retiré ${removed.length} fichier(s) géré(s)${kept.length ? `, conservé ${kept.length} fichier(s) modifié(s) localement` : ''}. ${bool(p, 'purge') ? '.ceng/ supprimé.' : 'Project Brain conservé dans .ceng/.'}`, { removed, kept });
}
