import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { checkDependency, ensureBaseline, readVetted, recordCheck, runDependenciesGate } from '../src/app/deps.js';
import { BrainStore } from '../src/brain/store.js';
import { assessDependency, parseManifest } from '../src/domain/deps.js';
import { cli, rm, runtimeHook, sandbox, task } from './helpers.js';

describe('lecture des manifestes', () => {
  it('npm : dépendances et dev, locales ignorées', () => {
    const d = parseManifest('package.json', JSON.stringify({ dependencies: { express: '^4', local: 'file:../x' }, devDependencies: { vitest: '^2' } }));
    assert.deepEqual(d.map((x) => `${x.name}:${x.dev}`), ['express:false', 'vitest:true']);
  });
  it('pubspec : SDK Flutter et chemins ignorés', () => {
    const d = parseManifest('app/pubspec.yaml', 'name: a\ndependencies:\n  flutter:\n    sdk: flutter\n  dio: ^5.0.0\n  mine:\n    path: ../mine\ndev_dependencies:\n  mocktail: ^1.0.0\n');
    assert.deepEqual(d.map((x) => `${x.name}:${x.dev}`), ['dio:false', 'mocktail:true']);
  });
  it('requirements, pyproject, Cargo, go.mod', () => {
    assert.deepEqual(parseManifest('requirements.txt', '# c\nFlask==3.0\n-r other.txt\nrequests>=2\n').map((x) => x.name), ['flask', 'requests']);
    assert.deepEqual(parseManifest('pyproject.toml', '[project]\ndependencies = [\n  "fastapi>=0.1",\n  "pydantic",\n]\n').map((x) => x.name), ['fastapi', 'pydantic']);
    assert.deepEqual(parseManifest('Cargo.toml', '[package]\nname="x"\n[dependencies]\nserde = "1"\nlocal = { path = "../l" }\n[dev-dependencies]\ncriterion = "0.5"\n').map((x) => x.name), ['serde', 'criterion']);
    assert.deepEqual(parseManifest('go.mod', 'module m\nrequire (\n\tgithub.com/a/b v1.0.0\n\tgithub.com/c/d v1.1.0 // indirect\n)\n').map((x) => x.name), ['github.com/a/b']);
  });
});

describe('jugement d\'une dépendance', () => {
  const now = Date.parse('2026-11-20');
  const base = { name: 'x', eco: 'npm' as const, version: '2.1.0', license: 'MIT', lastPublish: '2026-10-01', firstPublish: '2020-01-01', versions: 40, weeklyDownloads: 500_000, advisories: 0 };
  it('saine : ok', () => assert.equal(assessDependency(base, now).verdict, 'ok'));
  it('vulnérabilité, dépréciée, copyleft fort, sans licence : rejet', () => {
    for (const bad of [{ advisories: 2 }, { deprecated: 'use y' }, { license: 'AGPL-3.0' }, { license: undefined }]) assert.equal(assessDependency({ ...base, ...bad }, now).verdict, 'reject');
  });
  it('ancienne, peu utilisée, pré-1.0, très récente : à examiner', () => {
    for (const w of [{ lastPublish: '2023-01-01' }, { weeklyDownloads: 40 }, { version: '0.3.1' }, { firstPublish: '2026-10-25', versions: 2 }, { license: 'LGPL-2.1' }]) assert.equal(assessDependency({ ...base, ...w }, now).verdict, 'review');
  });
});

describe('vérification, gate et hook', () => {
  let dir = '';
  let store: BrainStore;
  const realFetch = globalThis.fetch;
  before(() => {
    dir = sandbox('ts-library');
    assert.equal(cli(dir, ['init', '--yes']).code, 0);
    store = new BrainStore(dir);
  });
  after(() => {
    globalThis.fetch = realFetch;
    rm(dir);
  });
  const addDep = (name: string) => {
    const f = path.join(dir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(f, 'utf8'));
    pkg.dependencies = { ...pkg.dependencies, [name]: '^1.0.0' };
    fs.writeFileSync(f, JSON.stringify(pkg, null, 2));
  };

  it('première gate : référence créée ; une dépendance ajoutée ensuite fait échouer', () => {
    assert.equal(runDependenciesGate(store, task('T-0001')).status, 'pass');
    assert.ok(readVetted(store));
    addDep('paquet-inconnu');
    const g = runDependenciesGate(store, task('T-0001'));
    assert.equal(g.status, 'fail');
    assert.match(g.detail, /paquet-inconnu/);
  });

  it('le hook d\'écriture d\'un manifeste prévient immédiatement', () => {
    const r = runtimeHook(dir, 'code-check', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'package.json'), new_string: '"paquet-inconnu": "^1.0.0"' } });
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /dep check/);
  });

  it('rejet non enregistré sans --accept, enregistré avec ; sain enregistré', async () => {
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      if (u.endsWith('/packages/paquet-inconnu')) return new Response(JSON.stringify({ versions: [{ versionKey: { version: '1.0.0' }, publishedAt: '2026-10-01T00:00:00Z', isDefault: true }] }));
      if (u.includes('/versions/')) return new Response(JSON.stringify({ licenses: ['GPL-3.0'], advisoryKeys: [] }));
      if (u.includes('api.npmjs.org')) return new Response(JSON.stringify({ downloads: 90_000 }));
      return new Response('', { status: 404 });
    }) as typeof fetch;
    const r = await checkDependency({ name: 'paquet-inconnu', eco: 'npm', dev: false });
    assert.equal(r.assessment.verdict, 'reject');
    assert.equal(recordCheck(store, r), false);
    assert.equal(runDependenciesGate(store, task('T-0001')).status, 'fail');
    assert.equal(recordCheck(store, r, 'licence compatible : projet sous GPL'), true);
    assert.equal(runDependenciesGate(store, task('T-0001')).status, 'pass');
  });

  it('paquet introuvable : rejet ; registre injoignable : jamais un feu vert', async () => {
    globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch;
    assert.equal((await checkDependency({ name: 'zzz', eco: 'npm', dev: false })).assessment.verdict, 'reject');
    globalThis.fetch = (async () => {
      throw new Error('réseau coupé');
    }) as typeof fetch;
    const r = await checkDependency({ name: 'zzz', eco: 'npm', dev: false });
    assert.ok(r.error);
    assert.equal(recordCheck(store, r), false);
    assert.equal(ensureBaseline(store), false);
  });
});
