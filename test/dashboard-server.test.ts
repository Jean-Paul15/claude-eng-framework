import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as vm from 'node:vm';
import { loadDashboardState } from '../src/app/dashboard.js';
import { runningDashboard, stablePort, startDashboard, type RunningDashboard } from '../src/app/dashboard-server.js';
import { renderDashboardPage, renderHomePage } from '../src/generation/dashboard-page.js';
import { BrainStore } from '../src/brain/store.js';
import { cli, json, rm, runtimeHook, sandbox } from './helpers.js';

/** Requête brute : permet d'imposer l'en-tête `Host` (que `fetch` interdit de modifier). */
function get(port: number, urlPath: string, host: string, method = 'GET'): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers: { Host: host } }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => { body += c.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Ouvre le flux d'événements et rend une promesse par message reçu. */
function subscribe(port: number): { next: () => Promise<{ total: number }>; close: () => void } {
  const queue: ((s: { total: number }) => void)[] = [];
  const buffered: { total: number }[] = [];
  const req = http.get({ host: '127.0.0.1', port, path: '/events', headers: { Host: `127.0.0.1:${port}` } }, (res) => {
    let acc = '';
    res.on('data', (c: Buffer) => {
      acc += c.toString();
      let i: number;
      while ((i = acc.indexOf('\n\n')) >= 0) {
        const frame = acc.slice(0, i);
        acc = acc.slice(i + 2);
        const data = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!data) continue;
        const state = (JSON.parse(data.slice(6)) as { activity: { total: number } }).activity;
        const waiter = queue.shift();
        if (waiter) waiter(state); else buffered.push(state);
      }
    });
  });
  return {
    next: () => new Promise((resolve) => { const b = buffered.shift(); if (b) resolve(b); else queue.push(resolve); }),
    close: () => req.destroy(),
  };
}

describe('tableau de bord vivant', () => {
  let dir: string;
  let dash: RunningDashboard;
  before(async () => {
    dir = sandbox('api-backend');
    assert.equal(cli(dir, ['init', '--yes', '--goal', 'API']).code, 0);
    dash = await startDashboard(new BrainStore(dir), { port: 0 });
  });
  after(async () => {
    await dash.close();
    rm(dir);
  });

  it('sert la page avec l\'état embarqué, une politique de contenu stricte et sans CORS', async () => {
    const r = await get(dash.port, '/', `127.0.0.1:${dash.port}`);
    assert.equal(r.status, 200);
    assert.match(r.body, /data-mode="live"/);
    assert.match(r.body, /<script id="state"/);
    assert.match(String(r.headers['content-security-policy']), /default-src 'none'/);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  });

  it('refuse un hôte inconnu (DNS rebinding) et toute méthode autre que GET', async () => {
    assert.equal((await get(dash.port, '/api/state', 'evil.example')).status, 403);
    assert.equal((await get(dash.port, '/api/state', `127.0.0.1:${dash.port}`, 'POST')).status, 405);
    assert.equal((await get(dash.port, '/api/state', `localhost:${dash.port}`)).status, 200);
  });

  it('ne sort pas du dossier des captures', async () => {
    const r = await get(dash.port, '/shots/..%2F..%2Fconfig.json', `127.0.0.1:${dash.port}`);
    assert.equal(r.status, 404);
  });

  it('pousse un nouvel état dès qu\'une action est enregistrée', async () => {
    const sub = subscribe(dash.port);
    try {
      const first = await sub.next();
      cli(dir, ['task', 'add', '--title', 'Nouvelle tâche', '--kind', 'chore']);
      let latest = first;
      const deadline = Date.now() + 5000;
      while (latest.total === first.total && Date.now() < deadline) latest = await sub.next();
      assert.ok(latest.total > first.total, 'le nombre d\'actions augmente sans recharger la page');
    } finally {
      sub.close();
    }
  });

  it('s\'enregistre pour qu\'on le retrouve, puis s\'efface à l\'arrêt', async () => {
    const store = new BrainStore(dir);
    assert.equal(runningDashboard(store)?.port, dash.port);
    assert.equal(stablePort(dir), stablePort(path.resolve(dir)));
    await dash.close();
    assert.equal(runningDashboard(store), undefined);
    assert.ok(!fs.existsSync(path.join(dir, '.ceng', 'dashboard.json')));
  });
});

/** Le script de la page n'est pas vérifié par TypeScript : on le compile ici pour attraper toute faute de syntaxe. */
function embeddedScripts(html: string): string[] {
  return [...html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
}

describe('page du tableau de bord', () => {
  let dir: string;
  before(() => {
    dir = sandbox('api-backend');
    assert.equal(cli(dir, ['init', '--yes', '--goal', 'API']).code, 0);
  });
  after(() => rm(dir));

  it('le script de la page et celui de l\'accueil se compilent, sans aucune ressource externe', () => {
    const state = loadDashboardState(new BrainStore(dir));
    for (const html of [renderDashboardPage(state, 'live'), renderDashboardPage(state, 'snapshot'), renderHomePage()]) {
      const scripts = embeddedScripts(html);
      assert.ok(scripts.length > 0);
      for (const code of scripts) assert.doesNotThrow(() => new vm.Script(code));
      assert.ok(!/(src|href)=["']https?:/.test(html) && !/url\(["']?https?:/.test(html), 'aucune ressource externe');
      assert.match(html, /font\/woff2;base64,/, 'police intégrée');
      assert.match(html, /scrollbar-width:none/, 'barres de défilement masquées, le défilement reste possible');
    }
  });

  it('un texte du projet ne peut pas refermer la balise du script d\'état', () => {
    const state = loadDashboardState(new BrainStore(dir));
    state.project = '</script><script>alert(1)</script>';
    const html = renderDashboardPage(state, 'live');
    assert.ok(!html.includes('<script>alert(1)'));
    assert.match(html, /\u003c\/script/);
  });

  it('la copie du projet embarque les ressources : le tableau de bord se lance depuis `.ceng/runtime`', async () => {
    assert.ok(fs.existsSync(path.join(dir, '.ceng/runtime/dashboard-assets/style.css')));
    const runtime = path.join(dir, '.ceng/runtime/cli.js');
    const out = JSON.parse(execFileSync(process.execPath, [runtime, 'dashboard', '--background', '--no-open', '--dir', dir, '--json'], { encoding: 'utf8' })) as { url: string };
    try {
      const port = Number(new URL(out.url).port);
      const r = await get(port, '/', `127.0.0.1:${port}`);
      assert.equal(r.status, 200);
      assert.match(r.body, /data-mode="live"/);
    } finally {
      execFileSync(process.execPath, [runtime, 'dashboard', 'stop', '--dir', dir]);
    }
  });

  it('config dashboard on : la session démarre le tableau de bord et en donne l\'adresse', async () => {
    assert.equal(cli(dir, ['config', 'dashboard', 'on']).code, 0);
    try {
      const start = () => (JSON.parse(runtimeHook(dir, 'session-start', { session_id: 's1', source: 'startup' }).stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
      // Le démarrage peut dépasser l'attente du hook sur une machine chargée : alors la note l'indique, et la session suivante trouve le serveur prêt.
      assert.match(start(), /Tableau de bord en direct \(se met à jour à chaque action\) : http:\/\/127\.0\.0\.1:\d+\/|Tableau de bord demandé mais pas encore prêt/);
      const deadline = Date.now() + 15_000;
      while (!runningDashboard(new BrainStore(dir)) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 200));
      assert.match(start(), /Tableau de bord en direct \(se met à jour à chaque action\) : http:\/\/127\.0\.0\.1:\d+\//);
    } finally {
      cli(dir, ['dashboard', 'stop']);
      cli(dir, ['config', 'dashboard', 'off']);
    }
    assert.equal(json<{ dashboard: boolean }>(cli(dir, ['config', 'dashboard', '--json'])).dashboard, false);
  });
});

describe('accueil de plusieurs projets', () => {
  let a: string;
  let b: string;
  let dash: RunningDashboard;
  before(async () => {
    a = sandbox('api-backend');
    b = sandbox('ts-library');
    for (const d of [a, b]) assert.equal(cli(d, ['init', '--yes', '--goal', 'X']).code, 0);
    dash = await startDashboard(new BrainStore(a), { port: 0, all: [new BrainStore(a), new BrainStore(b)] });
  });
  after(async () => {
    await dash.close();
    rm(a);
    rm(b);
  });

  it('accueil, résumé des projets, redirection, page et état de chaque projet', async () => {
    const host = `127.0.0.1:${dash.port}`;
    assert.match((await get(dash.port, '/', host)).body, /Mes projets/);
    const rows = JSON.parse((await get(dash.port, '/api/projects', host)).body) as { name: string; total: number }[];
    assert.equal(rows.length, 2);
    const moved = await get(dash.port, '/p/0', host);
    assert.equal(moved.status, 301);
    assert.equal(moved.headers['location'], '/p/0/');
    assert.match((await get(dash.port, '/p/1/', host)).body, /data-mode="live"/);
    assert.equal((JSON.parse((await get(dash.port, '/p/1/api/state', host)).body) as { project: string }).project, rows[1]!.name);
    assert.equal((await get(dash.port, '/p/9/', host)).status, 404);
  });
});
