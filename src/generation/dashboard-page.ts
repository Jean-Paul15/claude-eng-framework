import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DashboardState } from '../domain/dashboard-state.js';
import { locateFramework } from './install.js';

/**
 * Page du tableau de bord : un seul document HTML autonome (feuille de style, police et scripts inclus, aucune ressource externe), assemblé
 * à partir de `assets/dashboard/`. L'état y est embarqué : la page s'affiche aussitôt, hors ligne comme en direct. En mode `live`,
 * le script s'abonne ensuite au serveur local et se met à jour à chaque changement ; en mode `snapshot`, il reste figé.
 */

export type PageMode = 'live' | 'snapshot';

/** Ordre de concaténation : chaque fichier ne dépend que des précédents. */
const SCRIPTS = ['util.js', 'charts.js', 'iso.js', 'scenes.js', 'views.js', 'app.js'] as const;

/** Copie du runtime d'un projet (`.ceng/runtime/dashboard-assets/`) d'abord, sinon le dépôt du framework (`assets/dashboard/`). */
export function dashboardAssets(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fw = locateFramework();
  const candidates = [path.resolve(here, '..', 'dashboard-assets'), ...(fw ? [path.join(fw.root, 'assets', 'dashboard')] : [])];
  const found = candidates.find((d) => fs.existsSync(path.join(d, 'style.css')));
  if (!found) throw new Error('Ressources du tableau de bord introuvables : relancer `ceng upgrade` (ou lancer `ceng dashboard` depuis le ceng global).');
  return found;
}

/** JSON sûr dans une balise `<script>` : `<` et U+2028/2029 échappés pour qu'aucun texte du projet ne referme la balise. */
const embed = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export function renderDashboardPage(state: DashboardState, mode: PageMode, assetsDir = dashboardAssets()): string {
  const read = (f: string) => fs.readFileSync(path.join(assetsDir, f), 'utf8');
  const title = state.project.replace(/[<>&"]/g, '');
  const font = fs.readFileSync(path.join(assetsDir, 'font.woff2')).toString('base64');
  const css = read('style.css').replace('__FONT__', font);
  const js = SCRIPTS.map(read).join('\n');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Livraison ${title}</title><style>${css}</style></head><body data-mode="${mode}">${read('body.html')}<script id="state" type="application/json">${embed(state)}</script><script>(function(){${js}\n})();</script></body></html>`;
}

const HOME_SCRIPTS = ['util.js', 'home.js'] as const;

/** Accueil multi-projets : une carte par projet avec son avancement ; la page interroge `/api/projects` toutes les quelques secondes. */
export function renderHomePage(assetsDir = dashboardAssets()): string {
  const read = (f: string) => fs.readFileSync(path.join(assetsDir, f), 'utf8');
  const font = fs.readFileSync(path.join(assetsDir, 'font.woff2')).toString('base64');
  const css = read('style.css').replace('__FONT__', font);
  const js = HOME_SCRIPTS.map(read).join('\n');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mes projets</title><style>${css}</style></head><body data-mode="home">${read('home.html')}<script>(function(){${js}\n})();</script></body></html>`;
}
