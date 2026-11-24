import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { cli, json, rm, sandbox } from './helpers.js';
import type { Task } from '../src/domain/types.js';

// Faux identifiant construit à l'exécution (pas de motif de secret littéral dans le dépôt).
const FAKE_AWS = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
let dir = '';
const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
const run = (...a: string[]) => cli(dir, a);
const gateStatus = (id: string, gate: string) => json<{ gate: string; status: string }[]>(run('gate', 'run', id, '--json')).find((g) => g.gate === gate)?.status;

before(() => {
  dir = sandbox('api-backend');
  assert.equal(cli(dir, ['init', '--yes', '--goal', 'API']).code, 0);
  const cfgPath = path.join(dir, '.ceng/config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.commands = { build: 'node -e "process.exit(0)"', typecheck: 'node -e "process.exit(0)"', lint: 'node -e "process.exit(0)"', unit: 'node -e "process.exit(0)"' };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  git('add', '-A');
  git('commit', '-q', '-m', 'chore: ceng');
});
after(() => rm(dir));

describe('gates secrets et diagrams : diff depuis le début de la tâche', () => {
  it('voit un secret même commité avant la gate', () => {
    run('task', 'add', '--title', 'Config', '--kind', 'feature', '--files', 'app/**');
    run('task', 'start', 'T-0001');
    fs.writeFileSync(path.join(dir, 'app', 'leak.txt'), `key=${FAKE_AWS}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', 'feat: config');
    assert.equal(gateStatus('T-0001', 'secrets'), 'fail');
  });

  it('un diagramme commité par la tâche compte comme mis à jour', () => {
    run('task', 'add', '--title', 'Cycle commande', '--kind', 'feature', '--domains', 'lifecycle', '--files', 'docs/**');
    run('task', 'start', 'T-0002');
    fs.mkdirSync(path.join(dir, 'docs', 'diagrams'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'diagrams', 'commande.md'), '```mermaid\nstateDiagram-v2\n  [*] --> creee\n```\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'docs: diagramme');
    assert.equal(gateStatus('T-0002', 'diagrams'), 'pass');
  });

  it('mémorise le commit de départ ; une base disparue se replie sur HEAD', () => {
    const tasks = JSON.parse(fs.readFileSync(path.join(dir, '.ceng/brain/tasks.json'), 'utf8')).tasks as Task[];
    assert.match(tasks[0]!.attempts[0]!.baseCommit ?? '', /^[0-9a-f]{40}$/);
    tasks[0]!.attempts[0]!.baseCommit = '0'.repeat(40);
    fs.writeFileSync(path.join(dir, '.ceng/brain/tasks.json'), JSON.stringify({ schemaVersion: 1, tasks }, null, 2));
    assert.notEqual(run('gate', 'run', 'T-0001').code, 2);
  });

  it('une tâche sans commit de base garde le comportement d\'avant', () => {
    const tasks = JSON.parse(fs.readFileSync(path.join(dir, '.ceng/brain/tasks.json'), 'utf8')).tasks as Task[];
    delete tasks[1]!.attempts[0]!.baseCommit;
    fs.writeFileSync(path.join(dir, '.ceng/brain/tasks.json'), JSON.stringify({ schemaVersion: 1, tasks }, null, 2));
    assert.ok(['pass', 'fail'].includes(gateStatus('T-0002', 'diagrams') ?? ''));
  });
});
