import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { exists, listFiles, readJson, writeJsonAtomic } from '../infra/fs.js';

/**
 * Registre local des projets initialisés sur CETTE machine (`~/.ceng/registry.json`, ou `$CENG_HOME`) et empreinte du
 * framework installé. Sert à mettre tous les projets à jour d'un coup (`ceng upgrade --all`) et à mettre un projet à jour
 * tout seul au démarrage d'une session quand le framework de la machine est plus récent que sa copie. Le registre n'est
 * qu'une commodité de la machine : un projet cloné ailleurs fonctionne sans lui (runtime versionné dans `.ceng/runtime/`).
 */

export interface Registry {
  /** Racine du framework sur cette machine (dépôt lié par `npm link`, ou cache npx). */
  framework?: string;
  projects: string[];
}

export const cengHome = (): string => process.env['CENG_HOME'] ?? path.join(os.homedir(), '.ceng');
const registryPath = (): string => path.join(cengHome(), 'registry.json');

export function readRegistry(): Registry {
  return readJson<Registry>(registryPath()) ?? { projects: [] };
}

/** Le cache de npx est éphémère : seul un framework installé durablement (dépôt lié, installation globale) est retenu. */
const isEphemeral = (root: string): boolean => /[\\/]_npx[\\/]|[\\/]npm-cache[\\/]/i.test(root);

export function registerProject(projectRoot: string, frameworkRoot: string): void {
  try {
    const reg = readRegistry();
    const root = path.resolve(projectRoot);
    const projects = [...new Set([...reg.projects.filter(exists), root])];
    const framework = isEphemeral(frameworkRoot) ? reg.framework : path.resolve(frameworkRoot);
    writeJsonAtomic(registryPath(), { ...(framework ? { framework } : {}), projects });
  } catch {
    // commodité de la machine : son échec n'empêche jamais une installation
  }
}

const STACK_FILES = new Set(['package.json', 'pubspec.yaml', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml', 'composer.json', 'Gemfile', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'config.toml', 'Dockerfile']);

/**
 * Empreinte de la pile du projet : manifestes présents (racine et deux niveaux) avec taille et date. Quand elle change, les commandes des
 * gates et les skills de la pile sont à re-détecter (`ceng upgrade`) : sur un projet vide à l'init, build, tests et lint restent « skipped »
 * tant que personne n'a relancé la découverte.
 */
export function stackFingerprint(root: string): string {
  const hash = createHash('sha256');
  for (const f of listFiles(root, { maxDepth: 2, maxFiles: 5000 }).files.filter((x) => STACK_FILES.has(path.posix.basename(x)))) {
    try {
      const st = fs.statSync(path.join(root, f));
      hash.update(`${f}:${st.size}:${Math.round(st.mtimeMs)}
`);
    } catch {
      /* fichier disparu entre-temps */
    }
  }
  return hash.digest('hex').slice(0, 16);
}

/**
 * Empreinte du framework : tailles et dates des fichiers livrés (`core/`, `dist/src/`). Lecture de métadonnées seulement
 * (quelques millisecondes). Une reconstruction à l'identique change l'empreinte : la mise à jour qui suit est sans effet.
 */
export function frameworkFingerprint(frameworkRoot: string): string | undefined {
  const hash = createHash('sha256');
  let seen = 0;
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) {
        const st = fs.statSync(abs);
        hash.update(`${path.relative(frameworkRoot, abs)}:${st.size}:${Math.floor(st.mtimeMs)}\n`);
        seen++;
      }
    }
  };
  walk(path.join(frameworkRoot, 'core'));
  walk(path.join(frameworkRoot, 'dist', 'src'));
  return seen ? hash.digest('hex').slice(0, 16) : undefined;
}

/** CLI du framework de la machine, si elle existe. */
export function frameworkCli(frameworkRoot: string): string | undefined {
  const cli = path.join(frameworkRoot, 'dist', 'src', 'cli.js');
  return exists(cli) ? cli : undefined;
}

/** Lance la mise à jour du projet en arrière-plan (détachée : la session ne l'attend pas). */
export function upgradeInBackground(cli: string, projectRoot: string): void {
  const child = spawn(process.execPath, [cli, 'upgrade', '--dir', projectRoot], { cwd: projectRoot, detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, CENG_AUTO_UPGRADE_CHILD: '1' } });
  child.unref();
}
