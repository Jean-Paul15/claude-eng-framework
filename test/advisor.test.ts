import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { advisorOutranks, isAdvisorModel } from '../src/domain/advisor.js';
import { buildLaunchPlan } from '../src/cli/commands/run.js';
import { BrainStore } from '../src/brain/store.js';
import { cli, rm, runtimeHook, sandbox } from './helpers.js';

let dir = '';
before(() => {
  dir = sandbox('api-backend');
  assert.equal(cli(dir, ['init', '--yes']).code, 0);
});
after(() => rm(dir));

describe('conseiller (advisor)', () => {
  it('règle d\'appariement : au moins le niveau du modèle principal', () => {
    assert.ok(advisorOutranks('fable', 'opus'));
    assert.ok(advisorOutranks('claude-opus-5-5', 'sonnet'));
    assert.ok(!advisorOutranks('sonnet', 'opus'));
    assert.ok(isAdvisorModel('fable') && isAdvisorModel('claude-opus-5-5') && !isAdvisorModel('gpt'));
  });

  it('refuse un modèle inconnu, accepte fable, avertit si trop faible', () => {
    assert.notEqual(cli(dir, ['advisor', 'gpt']).code, 0);
    assert.match(cli(dir, ['advisor', 'haiku']).stderr, /Usage/);
    const r = cli(dir, ['advisor', 'sonnet']);
    assert.match(r.stdout, /Attention/);
    assert.match(cli(dir, ['advisor', 'fable']).stdout, /--advisor fable/);
  });

  it('le lancement passe --advisor, le brief donne la consigne, off retire tout', () => {
    const plan = buildLaunchPlan(new BrainStore(dir), {});
    assert.deepEqual(plan.args.slice(plan.args.indexOf('--advisor'), plan.args.indexOf('--advisor') + 2), ['--advisor', 'fable']);
    const brief = JSON.parse(runtimeHook(dir, 'session-start', { source: 'startup' }).stdout).hookSpecificOutput.additionalContext as string;
    assert.match(brief, /Conseiller actif/);
    assert.equal(cli(dir, ['advisor', 'off']).code, 0);
    assert.ok(!buildLaunchPlan(new BrainStore(dir), {}).args.includes('--advisor'));
  });

  it('survit à une mise à jour du projet', () => {
    cli(dir, ['advisor', 'opus']);
    assert.equal(cli(dir, ['upgrade', '--yes']).code, 0);
    assert.match(cli(dir, ['advisor', 'status']).stdout, /opus/);
  });
});
