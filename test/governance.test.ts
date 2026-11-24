import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { cli, rm, runtimeHook, sandbox } from './helpers.js';

let dir = '';
const run = (...a: string[]) => cli(dir, a);

before(() => {
  dir = sandbox('api-backend');
  assert.equal(cli(dir, ['init', '--yes', '--goal', 'API']).code, 0);
  const cfgPath = path.join(dir, '.ceng/config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.commands = { unit: 'node -e "process.exit(0)"' };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
});
after(() => rm(dir));

describe('contrats gelés (N-02)', () => {
  it('un sous-agent ne modifie pas un contrat gelé ; la session principale peut ; bump signale les tâches', () => {
    fs.mkdirSync(path.join(dir, 'api'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'api/openapi.yaml'), 'openapi: 3.1.0\n');
    assert.equal(run('contract', 'freeze', 'api/openapi.yaml').code, 0);
    const edit = (agent?: string) => runtimeHook(dir, 'guard-file', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'api/openapi.yaml') }, ...(agent ? { agent_id: agent, agent_type: 'ceng-builder' } : {}) });
    assert.match(edit('a1').stdout, /contrat gelé/);
    assert.ok(!edit().stdout.includes('contrat gelé'));
    run('task', 'add', '--title', 'Points de terminaison', '--kind', 'chore', '--files', 'api/**');
    run('task', 'start', 'T-0001');
    fs.writeFileSync(path.join(dir, 'api/openapi.yaml'), 'openapi: 3.1.0\npaths: {}\n');
    assert.match(run('contract', 'list').stdout, /modifié sans bump/);
    assert.match(run('ready').stdout, /✖ Contrats gelés inchangés/);
    assert.match(run('contract', 'bump', 'api/openapi.yaml', '--reason', 'nouveau point').stdout, /T-0001/);
    assert.doesNotMatch(run('contract', 'list').stdout, /modifié sans bump/);
  });
});

describe('boîte de décisions (S-07)', () => {
  it('rassemble approbations, décisions provisoires et tâches bloquées, bloquant d\'abord', () => {
    run('decision', 'add', '--title', 'Hébergement en Europe', '--context', 'c', '--decision', 'd', '--consequences', 'q', '--status', 'provisional', '--impact', 'low');
    run('task', 'add', '--title', 'Paiement', '--kind', 'chore');
    run('task', 'block', 'T-0002', '--reason', 'choix du prestataire');
    const r = run('inbox').stdout;
    assert.match(r, /1 décision\(s\) bloquante\(s\), 1 à confirmer/);
    assert.ok(r.indexOf('● BLOQUANT') < r.indexOf('○ à confirmer'));
  });
  it('signalée une fois par session, au premier message', () => {
    const msg = (s: string) => {
      const r = runtimeHook(dir, 'user-prompt', { prompt: 'oui', session_id: s });
      return r.stdout ? (JSON.parse(r.stdout).hookSpecificOutput?.additionalContext as string) : '';
    };
    assert.match(msg('sA'), /En attente de l'humain/);
    assert.equal(msg('sA'), '');
    assert.match(msg('sB'), /En attente de l'humain/);
  });
});

describe('clôture d\'incrément (N-04)', () => {
  it('refuse tant qu\'une tâche n\'est pas terminée, puis écrit le rapport', () => {
    run('task', 'add', '--title', 'Lot A', '--kind', 'chore', '--group', 'inc1');
    assert.equal(run('increment', 'close', 'inc1').code, 1);
    run('task', 'start', 'T-0003');
    assert.equal(run('task', 'done', 'T-0003', '--evidence', 'ok', '--waive', 'pas de gates sur ce test').code, 0);
    const r = run('increment', 'close', 'inc1');
    assert.equal(r.code, 0, r.stdout);
    assert.ok(fs.existsSync(path.join(dir, '.ceng/brain/increments/inc1.md')));
    assert.match(fs.readFileSync(path.join(dir, '.ceng/brain/increments/inc1.md'), 'utf8'), /Hébergement en Europe/);
  });
  it('groupe vide : échec explicite', () => assert.equal(run('increment', 'close', 'inconnu').code, 1));
});
