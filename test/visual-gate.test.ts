import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { visualEvidence } from '../src/app/gates.js';
import { cli, rm, sandbox } from './helpers.js';

let dir = '';
const run = (...a: string[]) => cli(dir, a);
const shots = (n: number, sub = '.ceng/shots/T-0001/parcours') => {
  fs.mkdirSync(path.join(dir, sub), { recursive: true });
  for (let i = 0; i < n; i++) fs.writeFileSync(path.join(dir, sub, `0${i}-etape_390.png`), 'png');
};

before(() => {
  dir = sandbox('web-shop');
  assert.equal(cli(dir, ['init', '--yes', '--goal', 'Boutique']).code, 0);
  assert.equal(run('task', 'add', '--title', 'Écran panier', '--kind', 'ui', '--files', 'src/cart/**').code, 0);
  assert.equal(run('task', 'start', 'T-0001').code, 0);
});
after(() => rm(dir));

describe('gate visual prouvée par des captures', () => {
  it('refuse pass sans capture', () => {
    const r = run('gate', 'record', 'T-0001', 'visual', 'pass', '--note', 'ok');
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /capture/);
  });

  it('refuse pass avec moins de 3 captures', () => {
    shots(2);
    assert.notEqual(run('gate', 'record', 'T-0001', 'visual', 'pass', '--note', 'ok').code, 0);
  });

  it('accepte pass avec 3 captures récentes et le dit dans le détail', () => {
    shots(3);
    assert.equal(run('gate', 'record', 'T-0001', 'visual', 'pass', '--note', 'relu').code, 0);
    assert.match(run('gate', 'list', 'T-0001').stdout, /visual/);
  });

  it('accepte waived et fail sans capture, et --shots ailleurs', () => {
    rm(path.join(dir, '.ceng/shots'));
    assert.equal(run('gate', 'record', 'T-0001', 'visual', 'waived', '--note', 'pas de rendu possible').code, 0);
    assert.equal(run('gate', 'record', 'T-0001', 'visual', 'fail', '--note', 'débordement').code, 0);
    shots(3, 'autre/dossier');
    assert.equal(run('gate', 'record', 'T-0001', 'visual', 'pass', '--note', 'ok', '--shots', 'autre/dossier').code, 0);
  });

  it('visualEvidence : dossier absent, captures antérieures ignorées', () => {
    assert.deepEqual(visualEvidence(path.join(dir, 'inexistant')), { images: [], fresh: 0 });
    assert.equal(visualEvidence(path.join(dir, 'autre/dossier'), new Date(Date.now() + 60_000).toISOString()).fresh, 0);
  });
});
