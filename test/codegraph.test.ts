import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { decideRefresh, graphifyAvailable } from '../src/app/codegraph.js';
import { CLI, rm, runtimeHook, sandbox } from './helpers.js';

const base = { enabled: true, available: true, graphExists: true, dirty: false, locked: false, trigger: 'turn-end' as const };

describe('graphe de code : décision de rafraîchissement', () => {
  it('ne fait rien si désactivé, absent, verrouillé ou sans modification', () => {
    assert.equal(decideRefresh({ ...base, enabled: false }).action, 'none');
    assert.equal(decideRefresh({ ...base, available: false }).action, 'none');
    assert.equal(decideRefresh({ ...base, dirty: true, locked: true }).action, 'none');
    assert.equal(decideRefresh(base).action, 'none');
  });
  it('construit si absent, met à jour si modifié ou en début de session', () => {
    assert.equal(decideRefresh({ ...base, graphExists: false }).action, 'build');
    assert.equal(decideRefresh({ ...base, dirty: true }).action, 'update');
    assert.equal(decideRefresh({ ...base, trigger: 'session-start' }).action, 'update');
  });
});

const dirs: string[] = [];
after(() => dirs.forEach(rm));
const hasGraphify = graphifyAvailable(process.cwd());

describe('graphe de code : intégration réelle avec graphify', { skip: hasGraphify ? false : 'graphify non installé sur cette machine' }, () => {
  it('init construit le graphe, puis les hooks le mettent à jour en arrière-plan après une modification', async () => {
    const dir = sandbox('ts-library');
    dirs.push(dir);
    const env = { ...process.env, CENG_NO_CODE_GRAPH: '0' };
    execFileSync(process.execPath, [CLI, 'init', '--yes', '--code-graph', 'on'], { cwd: dir, env, stdio: 'pipe' });
    const graph = path.join(dir, 'graphify-out', 'graph.json');
    assert.ok(fs.existsSync(graph), 'graphe construit à l\'init');
    const before = fs.readFileSync(graph, 'utf8');
    assert.ok(!before.includes('multiply'));
    fs.appendFileSync(path.join(dir, 'src/index.ts'), '\nexport function multiply(a: number, b: number) { return a * b }\n');
    process.env['CENG_NO_CODE_GRAPH'] = '0';
    try {
      runtimeHook(dir, 'file-edited', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src/index.ts') } });
      runtimeHook(dir, 'graph-refresh', { hook_event_name: 'Stop' });
    } finally {
      delete process.env['CENG_NO_CODE_GRAPH'];
    }
    const lock = path.join(dir, '.ceng', 'logs', 'graphify.lock');
    const deadline = Date.now() + 60_000;
    while (fs.existsSync(lock) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
    assert.ok(fs.readFileSync(graph, 'utf8').includes('multiply'), 'nouvelle fonction présente dans le graphe mis à jour');
  });
});
