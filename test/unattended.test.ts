import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { cli, rm, runtimeHook, sandbox } from './helpers.js';

/** Mode sans humain : rien n'attend jamais une réponse, le travail continue tant qu'il progresse. */
const dirs: string[] = [];
after(() => dirs.forEach(rm));

function withUnattended<T>(fn: () => T): T {
  process.env['CENG_UNATTENDED'] = '1';
  try {
    return fn();
  } finally {
    delete process.env['CENG_UNATTENDED'];
  }
}

describe('mode sans humain (nuit)', () => {
  const dir = sandbox('api-backend');
  dirs.push(dir);
  assert.equal(cli(dir, ['init', '--yes']).code, 0);
  assert.equal(cli(dir, ['task', 'add', '--title', 'A', '--complexity', '2', '--files', 'app/a/**']).code, 0);
  assert.equal(cli(dir, ['task', 'add', '--title', 'B', '--complexity', '2', '--files', 'app/b/**']).code, 0);
  const hook = (event: string, payload: unknown) => withUnattended(() => runtimeHook(dir, event, payload));

  it('une action à approbation est refusée (pas d\'attente) et consignée pour le réveil', () => {
    const out = JSON.parse(hook('guard-command', { tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } }).stdout);
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /MODE SANS HUMAIN/);
    const pending = fs.readFileSync(path.join(dir, '.ceng/brain/pending-approvals.md'), 'utf8');
    assert.match(pending, /- \[ \] .*git push --force/);
  });

  it('hors mode nuit, la même action est soumise à l\'humain via l\'invite', () => {
    const out = JSON.parse(runtimeHook(dir, 'guard-command', { tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } }).stdout);
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /Approuver R-\d{4}/);
  });

  it('le hook Stop relance tant qu\'il reste du travail, puis s\'arrête faute de progression', () => {
    const first = JSON.parse(hook('stop', { stop_hook_active: true }).stdout);
    assert.equal(first.decision, 'block');
    assert.match(first.reason, /MODE SANS HUMAIN/);
    // Sans aucun changement d'état, les relances suivantes finissent par s'arrêter (pas de boucle infinie).
    let stopped = false;
    for (let i = 0; i < 6 && !stopped; i++) stopped = hook('stop', { stop_hook_active: true }).stdout === '';
    assert.ok(stopped, 'arrêt après plusieurs relances sans progression');
  });

  it('s\'arrête quand plus rien n\'est faisable', () => {
    assert.equal(cli(dir, ['task', 'block', 'T-0001', '--reason', 'attend validation humaine']).code, 0);
    assert.equal(cli(dir, ['task', 'block', 'T-0002', '--reason', 'attend validation humaine']).code, 0);
    assert.equal(hook('stop', {}).stdout, '');
  });

  it('au réveil, le brief signale les validations en attente', () => {
    const ctx = JSON.parse(runtimeHook(dir, 'session-start', { source: 'startup' }).stdout).hookSpecificOutput.additionalContext as string;
    assert.match(ctx, /attendent une décision/);
    assert.match(ctx, /AskUserQuestion/);
  });

  it('ceng run --unattended : aucune invite de permission, mode auto, limites', () => {
    const r = cli(dir, ['run', '--unattended', '--dry-run', '--max-budget-usd', '5']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /CENG_UNATTENDED=1/);
    assert.match(r.stdout, /--permission-prompts none/);
    assert.match(r.stdout, /--permission-mode auto/);
    assert.match(r.stdout, /--max-budget-usd 5/);
    assert.match(r.stdout, /MODE SANS HUMAIN/);
  });

  it('refuse de partir la nuit sans objectif ni tâche', () => {
    const empty = sandbox('ts-library');
    dirs.push(empty);
    assert.equal(cli(empty, ['init', '--yes']).code, 0);
    const r = cli(empty, ['run', '--unattended', '--dry-run']);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /aucun objectif/);
  });
});
