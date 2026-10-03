import * as path from 'node:path';
import { Git } from '../infra/git.js';
import { buildScanContext, type ScanContext } from './context.js';
import { detectDomains, inferRisk } from './domains.js';
import { detectData, detectDocs, detectInfra, detectLegal, detectMcp, detectSecurity, detectServices } from './platform.js';
import type { ProjectProfile } from './profile.js';
import { detectCi, detectCommands, detectConventions, detectTesting } from './quality.js';
import { detectArchitecture, detectFrameworks, detectLanguages, detectPackageManagers, detectProjectTypes, detectUi } from './stack.js';

export type GitInfo = ProjectProfile['git'];

export function detectGit(root: string): GitInfo {
  const git = new Git(root);
  if (!git.isRepo()) return { isRepo: false, remotes: [], commitConvention: 'unknown', protectedBranches: ['main', 'master'], dirtyFiles: 0 };
  const subjects = git.recentSubjects();
  const conventional = subjects.filter((s) => /^(feat|fix|chore|docs|refactor|test|perf|build|ci|style|revert)(\(.+\))?!?:/.test(s)).length;
  const defaultBranch = git.defaultBranch();
  const currentBranch = git.currentBranch();
  return {
    isRepo: true,
    ...(defaultBranch ? { defaultBranch } : {}),
    ...(currentBranch ? { currentBranch } : {}),
    remotes: git.remotes(),
    commitConvention: subjects.length < 5 ? 'unknown' : conventional / subjects.length >= 0.6 ? 'conventional' : 'free-form',
    protectedBranches: [...new Set([defaultBranch ?? 'main', 'main', 'master', 'production', 'release'])],
    dirtyFiles: git.statusPorcelain().length,
  };
}

/** Assemble le profil à partir d'un contexte de scan (pur, testable) et d'infos git. */
export function profileFromContext(ctx: ScanContext, name: string, git: GitInfo): ProjectProfile {
  const { languages, primaryLanguage } = detectLanguages(ctx);
  const packageManagers = detectPackageManagers(ctx);
  const frameworks = detectFrameworks(ctx);
  const projectTypes = detectProjectTypes(ctx, frameworks);
  const services = detectServices(ctx);
  const { infra, deployment } = detectInfra(ctx);
  const domains = detectDomains(ctx, services);
  const data = detectData(ctx);
  if (data.databases.length > 0 && !domains.some((d) => d.name === 'database')) domains.push({ name: 'database', evidence: data.databases.join(', ') });
  if (projectTypes.includes('api')) domains.push({ name: 'api', evidence: 'framework serveur/API détecté' });
  const ui = detectUi(ctx, frameworks);
  if (ui) domains.push({ name: 'frontend', evidence: 'framework UI détecté' });
  const profile: ProjectProfile = {
    name: ctx.packageJson?.name ?? name,
    languages,
    ...(primaryLanguage ? { primaryLanguage } : {}),
    packageManagers,
    frameworks,
    projectTypes,
    ui,
    architecture: detectArchitecture(ctx),
    testing: detectTesting(ctx),
    ci: detectCi(ctx),
    ...data,
    services,
    mcp: detectMcp(ctx),
    git,
    conventions: detectConventions(ctx),
    docs: detectDocs(ctx),
    security: detectSecurity(ctx),
    legal: detectLegal(ctx),
    infra,
    deployment,
    domains,
    riskLevel: 'medium',
    commands: detectCommands(ctx, packageManagers),
    versions: pickVersions(ctx, frameworks),
    ...detectCodeGraph(ctx),
    truncatedScan: ctx.truncated,
  };
  profile.riskLevel = inferRisk(profile);
  return profile;
}

/** Graphe de code existant. On ne le construit jamais à l'init (coût LLM) : on le signale seulement. */
export function detectCodeGraph(ctx: ScanContext): Pick<ProjectProfile, 'codeGraph'> {
  const graph = ctx.files.find((f) => /(^|\/)graphify-out\/graph\.json$/.test(f));
  return graph ? { codeGraph: { tool: 'graphify', path: graph.slice(0, -'/graph.json'.length) } } : {};
}

function pickVersions(ctx: ScanContext, frameworks: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of frameworks) if (ctx.versions[f]) out[f] = ctx.versions[f]!;
  for (const k of ['typescript', 'stripe', 'prisma', '@prisma/client', 'python', 'sqlalchemy']) if (ctx.versions[k]) out[k] = ctx.versions[k]!;
  return out;
}

export function discover(root: string): ProjectProfile {
  return profileFromContext(buildScanContext(root), path.basename(path.resolve(root)), detectGit(root));
}
