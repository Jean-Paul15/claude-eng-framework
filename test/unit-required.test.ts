import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { cli, rm, sandbox } from './helpers.js';

let dir = '';
const run = (...a: string[]) => cli(dir, a);

before(() => {
  dir = sandbox('api-backend');
  assert.equal(cli(dir, ['init', '--yes']).code, 0);
  const f = path.join(dir, '.ceng/config.json');
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  c.commands = { build: 'node -e "process.exit(0)"', typecheck: 'node -e "process.exit(0)"', lint: 'node -e "process.exit(0)"' };
  fs.writeFileSync(f, JSON.stringify(c));
});
after(() => rm(dir));

describe('aucune commande de test : une fonctionnalité ne se clôt pas sans test exécuté (D-1)', () => {
  it('feature : refus avec la marche à suivre ; dérogation justifiée acceptée', () => {
    run('task', 'add', '--title', 'Nouvelle règle de remise', '--kind', 'feature', '--new', 'test');
    run('task', 'start', 'T-0001');
    run('gate', 'run', 'T-0001');
    const r = run('task', 'done', 'T-0001', '--evidence', 'x');
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /unit \(aucune commande de test/);
    assert.equal(run('task', 'done', 'T-0001', '--evidence', 'x', '--waive', 'pas encore de suite de tests, tâche T-0009 créée').code, 0);
  });
  it('chore : la gate unit absente reste acceptée', () => {
    run('task', 'add', '--title', 'Nettoyage', '--kind', 'chore', '--complexity', '1', '--risk', '1', '--context', 'S');
    run('task', 'start', 'T-0002');
    run('gate', 'run', 'T-0002');
    const r = run('task', 'done', 'T-0002', '--evidence', 'x');
    assert.equal(r.code, 0, r.stderr);
  });
});
