import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { readRegistry } from '../src/app/registry.js';
import { BrainPaths } from '../src/brain/paths.js';
import { cli, rm, sandbox } from './helpers.js';

/** Mise à jour sans passer projet par projet : registre de la machine, `upgrade --all`, mise à jour auto au démarrage. */
const dirs: string[] = [];
after(() => dirs.forEach(rm));

describe('mises à jour de tous les projets', () => {
  const a = sandbox('web-shop');
  const b = sandbox('ts-library');
  dirs.push(a, b);
  assert.equal(cli(a, ['init', '--yes']).code, 0);
  assert.equal(cli(b, ['init', '--yes']).code, 0);

  it('init enregistre le projet et le framework de la machine', () => {
    const reg = readRegistry();
    assert.ok(reg.projects.includes(path.resolve(a)) && reg.projects.includes(path.resolve(b)));
    assert.ok(reg.framework && fs.existsSync(path.join(reg.framework, 'core', 'skills')));
  });

  it('upgrade --all met à jour chaque projet et ignore un projet disparu', () => {
    const gone = sandbox('web-shop');
    assert.equal(cli(gone, ['init', '--yes']).code, 0);
    rm(gone);
    const r = cli(a, ['upgrade', '--all']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /à jour/);
    assert.doesNotMatch(r.stdout, /échec/);
  });

  it('démarrage de session : framework plus récent → mise à jour lancée et annoncée, une seule fois', async () => {
    const manifest = new BrainPaths(a).manifest;
    const m = JSON.parse(fs.readFileSync(manifest, 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(manifest, JSON.stringify({ ...m, frameworkBuild: 'ancienne' }));
    const start = () => {
      const out = execFileSync(process.execPath, [path.join(a, '.ceng', 'runtime', 'hooks', 'run.js'), 'session-start'], {
        cwd: a, encoding: 'utf8', input: JSON.stringify({ source: 'startup' }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: a, CENG_NO_AUTO_UPGRADE: '0', CENG_NO_CODE_GRAPH: '1' },
      });
      return (JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    };
    assert.match(start(), /mis à jour en arrière-plan/);
    assert.doesNotMatch(start(), /mis à jour en arrière-plan/, 'pas une seconde mise à jour dans les 10 minutes');
    // La mise à jour détachée a vraiment tourné : l'empreinte du projet rejoint celle du framework.
    const deadline = Date.now() + 90_000;
    const build = () => (JSON.parse(fs.readFileSync(manifest, 'utf8')) as { frameworkBuild?: string }).frameworkBuild;
    while (build() === 'ancienne' && Date.now() < deadline) await new Promise((r) => setTimeout(r, 300));
    assert.notEqual(build(), 'ancienne');
    await new Promise((r) => setTimeout(r, 1500)); // fin d'écriture de l'index et sortie du processus
  });
});
