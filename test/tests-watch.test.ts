import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { cli, rm, runtimeHook, sandbox } from './helpers.js';

let dir = '';
const run = (...a: string[]) => cli(dir, a);
const setUnit = (cmd: string) => {
  const f = path.join(dir, '.ceng/config.json');
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  c.commands.unit = cmd;
  fs.writeFileSync(f, JSON.stringify(c));
};
const write = (file: string) => runtimeHook(dir, 'tests-watch', { tool_name: 'Write', tool_input: { file_path: path.join(dir, file) } });
const hooks = () => JSON.stringify(JSON.parse(fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf8')).hooks);

before(() => {
  dir = sandbox('api-backend');
  assert.equal(cli(dir, ['init', '--yes']).code, 0);
});
after(() => rm(dir));

describe('contrôle continu des tests (N-01, sur option)', () => {
  it('désactivé par défaut : aucun hook installé, aucune exécution', () => {
    assert.ok(!hooks().includes('tests-watch'));
    setUnit('node -e "process.exit(1)"');
    assert.equal(write('app/x.py').code, 0);
  });

  it('activé : le hook est installé en arrière-plan avec réveil ; désactivé, il est retiré', () => {
    assert.equal(run('config', 'tests-watch', 'on').code, 0);
    assert.match(hooks(), /tests-watch/);
    assert.match(hooks(), /asyncRewake/);
    assert.equal(run('upgrade', '--yes').code, 0);
    assert.match(hooks(), /tests-watch/, 'survit à une mise à jour');
    assert.equal(run('config', 'tests-watch', 'off').code, 0);
    assert.ok(!hooks().includes('tests-watch'));
    run('config', 'tests-watch', 'on');
  });

  it('rouge : réveil (code 2) avec la sortie ; vert : silence ; fichier hors code : rien', () => {
    setUnit('node -e "console.error(\'1 test en échec\'); process.exit(1)"');
    const red = write('app/x.py');
    assert.equal(red.code, 2);
    assert.match(red.stderr, /Tests en échec[\s\S]*1 test en échec/);
    setUnit('node -e "process.exit(0)"');
    const green = write('app/x.py');
    assert.equal(green.code, 0);
    assert.equal(green.stderr, '');
    setUnit('node -e "process.exit(1)"');
    assert.equal(write('README.md').code, 0);
  });
});
