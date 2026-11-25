import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { ensureDashboard } from '../../app/dashboard-launch.js';
import { runningDashboard, runningHome, startDashboard, type RunningDashboard } from '../../app/dashboard-server.js';
import { readRegistry } from '../../app/registry.js';
import { BrainStore } from '../../brain/store.js';
import { bool, out, parse, str, UsageError } from '../args.js';

/**
 * `ceng dashboard` : tableau de bord vivant, à ouvrir une fois ; il se met à jour pendant que le travail avance.
 *   (sans option)  au premier plan, Ctrl+C pour arrêter · --background  détaché, l'adresse reste la même · stop  l'arrête
 *   --all          accueil de tous les projets de la machine (un clic pour ouvrir l'un d'eux) · --port N  port préféré · --no-open  n'ouvre pas le navigateur
 */

function openInBrowser(url: string): void {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => undefined).unref();
  } catch {
    // pas de navigateur : l'adresse est affichée
  }
}

/** Projets de la registre de la machine qui ont un cerveau ceng. */
function registeredStores(): BrainStore[] {
  return readRegistry().projects.map((root) => new BrainStore(root)).filter((s) => s.isInitialized());
}

function waitForSignal(dash: RunningDashboard): Promise<void> {
  return new Promise<void>((resolve) => {
    const stop = () => void dash.close().then(resolve);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

async function runAll(p: ReturnType<typeof parse>, open: boolean): Promise<void> {
  const stores = registeredStores();
  if (!stores.length) throw new UsageError('Aucun projet ceng enregistré sur cette machine : lancer `ceng init` dans un projet.');
  const existing = runningHome();
  if (existing) {
    if (open) openInBrowser(existing.url);
    return out(p, `Accueil des projets déjà en cours : ${existing.url}`, { url: existing.url });
  }
  const port = str(p, 'port') ? Number(str(p, 'port')) : undefined;
  const dash = await startDashboard(stores[0]!, { all: stores, ...(port === undefined ? {} : { port }) });
  out(p, `Accueil de ${stores.length} projet(s) : ${dash.url}\nCtrl+C pour l'arrêter.`, { url: dash.url, projects: stores.length });
  if (open) openInBrowser(dash.url);
  await waitForSignal(dash);
}

export async function dashboardCommand(argv: string[]): Promise<void> {
  const p = parse(argv, { dir: { type: 'string' }, port: { type: 'string' }, 'no-open': { type: 'boolean' }, background: { type: 'boolean' }, all: { type: 'boolean' } });
  const open = !bool(p, 'no-open');
  const sub = p.positionals[0];

  if (sub === 'stop') {
    const store = new BrainStore(path.resolve(str(p, 'dir') ?? process.cwd()));
    const run = bool(p, 'all') ? runningHome() : runningDashboard(store);
    if (!run) return out(p, 'Aucun tableau de bord en cours.', { running: false });
    process.kill(run.pid);
    return out(p, `Tableau de bord arrêté (${run.url}).`, { running: false });
  }
  if (sub !== undefined) throw new UsageError('Usage : ceng dashboard [--background] [--all] [--port N] [--no-open] · ceng dashboard stop [--all]');
  if (bool(p, 'all')) return runAll(p, open);

  const root = path.resolve(str(p, 'dir') ?? process.cwd());
  const store = new BrainStore(root);
  store.requireInitialized();
  const existing = runningDashboard(store);
  if (existing) {
    if (open) openInBrowser(existing.url);
    return out(p, `Tableau de bord déjà en cours : ${existing.url}`, { url: existing.url });
  }
  if (bool(p, 'background')) {
    const cli = process.argv[1];
    if (!cli) throw new UsageError('Impossible de relancer ceng en arrière-plan : chemin du programme inconnu.');
    const url = ensureDashboard(store, cli, 5000);
    if (!url) throw new UsageError("Le tableau de bord ne s'est pas lancé à temps : essayer `ceng dashboard` au premier plan pour voir l'erreur.");
    if (open) openInBrowser(url);
    return out(p, `Tableau de bord lancé en arrière-plan : ${url}\nPour l'arrêter : ceng dashboard stop`, { url });
  }

  const port = str(p, 'port') ? Number(str(p, 'port')) : undefined;
  if (port !== undefined && !(Number.isInteger(port) && port >= 1024 && port <= 65535)) throw new UsageError('--port : un nombre entre 1024 et 65535.');
  const dash = await startDashboard(store, port === undefined ? {} : { port });
  out(p, `Tableau de bord : ${dash.url}\nIl se met à jour tout seul. Ctrl+C pour l'arrêter.`, { url: dash.url });
  if (open) openInBrowser(dash.url);
  await waitForSignal(dash);
}
