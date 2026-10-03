import type { RiskLevel } from '../domain/types.js';

export type ProjectType = 'web-app' | 'api' | 'data' | 'ml' | 'mobile' | 'cli' | 'library' | 'infra' | 'desktop' | 'unknown';

export interface Evidence {
  name: string;
  evidence: string;
}

export interface Commands {
  install?: string;
  build?: string;
  typecheck?: string;
  lint?: string;
  format?: string;
  unit?: string;
  integration?: string;
  e2e?: string;
  contract?: string;
  'deps-audit'?: string;
  migration?: string;
  performance?: string;
  dev?: string;
}

/** Résultat de la découverte : ce que le framework sait du projet sans l'avoir modifié. */
export interface ProjectProfile {
  name: string;
  languages: { name: string; files: number }[];
  primaryLanguage?: string;
  packageManagers: string[];
  frameworks: string[];
  projectTypes: ProjectType[];
  ui: boolean;
  architecture: { monorepo: boolean; workspaces: string[]; styles: string[]; topLevelDirs: string[] };
  testing: { frameworks: string[]; e2e: string[]; testFiles: number; hasTests: boolean };
  ci: { providers: string[]; files: string[] };
  databases: string[];
  orm: string[];
  migrations: { tool: string; path: string }[];
  services: string[];
  mcp: { file?: string; servers: string[] };
  git: {
    isRepo: boolean;
    defaultBranch?: string;
    currentBranch?: string;
    remotes: string[];
    commitConvention: 'conventional' | 'free-form' | 'unknown';
    protectedBranches: string[];
    dirtyFiles: number;
  };
  conventions: { linters: string[]; formatters: string[]; typeCheckers: string[]; editorconfig: boolean; strictTypes: boolean };
  docs: { readme: boolean; docsDir?: string; adrDir?: string; contributing: boolean; changelog: boolean };
  security: { policy: boolean; dependabot: boolean; renovate: boolean; codeql: boolean; secretScanning: boolean; envExample: boolean; envFilesPresent: string[] };
  legal: { license?: string; licenseFile?: string; notice: boolean; privacyPolicy: boolean; codeOfConduct: boolean; codeowners: boolean; cla: boolean };
  infra: string[];
  deployment: string[];
  domains: Evidence[];
  riskLevel: RiskLevel;
  commands: Commands;
  versions: Record<string, string>;
  /** Graphe de code déjà construit (ex. graphify-out/graph.json) : à interroger pour les questions de structure. */
  codeGraph?: { tool: string; path: string };
  truncatedScan: boolean;
}
