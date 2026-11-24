import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { frameworkHooks } from '../src/generation/settings.js';
import { cli, rm, runtimeHook, sandbox } from './helpers.js';

const dirs: string[] = [];
after(() => dirs.forEach(rm));

function project() {
  const dir = sandbox('api-backend');
  dirs.push(dir);
  assert.equal(cli(dir, ['init', '--yes']).code, 0);
  return dir;
}
const REPORT = 'CENG_REPORT\nstatus: done\ntask: T-0001';
const stop = (dir: string, message: string) => runtimeHook(dir, 'subagent-stop', { agent_id: 'a1', agent_type: 'ceng-builder', last_assistant_message: message });

describe('rapport remis par SubagentHandback (P-02)', () => {
  it('un rapport remis par l\'outil évite le blocage', () => {
    const dir = project();
    runtimeHook(dir, 'agent-handback', { agent_id: 'a1', tool_input: { message: REPORT } });
    assert.ok(!stop(dir, 'Terminé.').stdout.includes('block'));
  });

  it('sans remise ni marqueur, l\'arrêt reste bloqué', () => {
    const dir = project();
    assert.match(stop(dir, 'Terminé.').stdout, /"decision":"block"/);
  });

  it('l\'entrée est effacée après l\'arrêt', () => {
    const dir = project();
    runtimeHook(dir, 'agent-handback', { agent_id: 'a1', tool_input: { message: REPORT } });
    stop(dir, 'ok');
    const state = JSON.parse(fs.readFileSync(path.join(dir, '.ceng/brain/state.json'), 'utf8'));
    assert.equal(state.handbackReports?.['a1'], undefined);
  });

  it('le hook est installé dans les réglages', () => {
    assert.ok(frameworkHooks()['PostToolUse']!.some((g) => g.matcher === 'SubagentHandback'));
  });
});

describe('contexte injecté au démarrage du sous-agent (P-09)', () => {
  const start = (dir: string, type: string) => runtimeHook(dir, 'subagent-start', { agent_id: 'a1', agent_type: type });
  const ctx = (r: { stdout: string }) => (r.stdout ? (JSON.parse(r.stdout).hookSpecificOutput?.additionalContext as string) : '');

  it('production : action à approbation remontée, jamais tentée', () => {
    const c = ctx(start(project(), 'ceng-builder'));
    assert.match(c, /Stade production/);
    assert.ok(c.length < 400);
  });

  it('bypass : annoncé au sous-agent', () => {
    const dir = project();
    const cfgPath = path.join(dir, '.ceng/config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.bypass = { enabled: true, since: new Date().toISOString() };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    assert.match(ctx(start(dir, 'ceng-scout')), /BYPASS TOTAL/);
  });

  it('agent étranger : rien', () => {
    assert.equal(start(project(), 'Explore').stdout, '');
  });
});

describe('compaction et reprise (P-06)', () => {
  it('pre-compact écrit des consignes de résumé en texte brut', () => {
    const r = runtimeHook(project(), 'pre-compact', { trigger: 'auto' });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Dans le résumé, conserver/);
  });

  it('le brief cite les autres tâches en cours et les sous-agents actifs', () => {
    const dir = project();
    for (const t of ['Un', 'Deux']) cli(dir, ['task', 'add', '--title', t, '--files', `${t}/**`]);
    cli(dir, ['task', 'start', 'T-0001']);
    cli(dir, ['task', 'start', 'T-0002']);
    const sf = path.join(dir, '.ceng/brain/state.json');
    const s = JSON.parse(fs.readFileSync(sf, 'utf8'));
    s.runningAgents = { a9: 'T-0001' };
    s.agentStartedAt = { a9: new Date().toISOString() };
    fs.writeFileSync(sf, JSON.stringify(s));
    const out = JSON.parse(runtimeHook(dir, 'session-start', { source: 'resume' }).stdout).hookSpecificOutput.additionalContext as string;
    assert.match(out, /Aussi en cours/);
    assert.match(out, /Sous-agents encore actifs sur : T-0001/);
    assert.ok(out.length <= 6100);
  });
});
