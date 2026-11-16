import { strict as assert } from 'node:assert';
import { after, describe, it } from 'node:test';
import { externalEffects } from '../src/app/intents.js';
import { cli, json, rm, runtimeHook, sandbox } from './helpers.js';

/**
 * Journal d'intention (motif « loop breakpoint ») : une action à effet extérieur est consignée avant de s'exécuter et close
 * à son résultat ; une session coupée entre les deux laisse un avertissement à la session suivante.
 */
const dirs: string[] = [];
after(() => dirs.forEach(rm));

describe('journal d\'intention des actions à effet extérieur', () => {
  it('reconnaît ce qui sort de la machine, pas le travail local', () => {
    assert.deepEqual(externalEffects('vercel --prod'), ['deploy']);
    assert.deepEqual(externalEffects('cd app && git push origin main 2>&1 | tail -3'), ['git-push']);
    assert.deepEqual(externalEffects('npm test && git commit -m "deploy fix"'), []);
    assert.deepEqual(externalEffects('ls'), []);
  });

  it('ouverte avant, close au résultat ; sans résultat, la session suivante est prévenue', () => {
    const dir = sandbox('web-shop');
    dirs.push(dir);
    assert.equal(cli(dir, ['init', '--yes']).code, 0);
    assert.equal(cli(dir, ['bypass', 'on']).code, 0);
    const brief = () => json<{ hookSpecificOutput: { additionalContext: string } }>(runtimeHook(dir, 'session-start', { source: 'startup' })).hookSpecificOutput.additionalContext;
    const pre = (command: string) => runtimeHook(dir, 'guard-command', { session_id: 's1', cwd: dir, tool_name: 'Bash', tool_input: { command } });
    const post = (command: string) => runtimeHook(dir, 'command-done', { session_id: 's1', cwd: dir, tool_name: 'Bash', tool_input: { command } });

    pre('vercel --prod');
    post('vercel --prod');
    assert.doesNotMatch(brief(), /sans résultat enregistré/, 'résultat reçu : rien à signaler');

    pre('supabase db push');
    // session coupée ici : aucun PostToolUse
    const warned = brief();
    assert.match(warned, /1 action\(s\) à effet extérieur/);
    assert.match(warned, /supabase db push/);

    pre('supabase db push');
    post('supabase db push');
    assert.doesNotMatch(brief(), /sans résultat enregistré/, 'une relance qui aboutit clôt l\'intention');
  });

  it('une action refusée n\'ouvre pas d\'intention', () => {
    const dir = sandbox('web-shop');
    dirs.push(dir);
    assert.equal(cli(dir, ['init', '--yes']).code, 0);
    runtimeHook(dir, 'guard-command', { session_id: 's2', cwd: dir, tool_name: 'Bash', tool_input: { command: 'vercel --prod' } });
    const ctx = json<{ hookSpecificOutput: { additionalContext: string } }>(runtimeHook(dir, 'session-start', { source: 'startup' })).hookSpecificOutput.additionalContext;
    assert.doesNotMatch(ctx, /sans résultat enregistré/);
  });
});
