import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { classifyCommand } from '../src/domain/guardrails.js';
import { mergeSettings, type ClaudeSettings } from '../src/generation/settings.js';
import { BrainPaths } from '../src/brain/paths.js';
import { cli, json, rm, runtimeHook, sandbox } from './helpers.js';

/**
 * Bypass total : décision humaine. Une fois activé, plus aucune validation ni refus (secrets, .env, garde-fous, interdictions
 * comprises) ; tout est journalisé et un instantané est pris avant une suppression.
 */
const dirs: string[] = [];
after(() => dirs.forEach(rm));

describe('bypass total', () => {
  it('l\'activer ou le couper est une décision humaine (l\'agent ne peut pas se l\'accorder)', () => {
    const v = classifyCommand('node .ceng/runtime/cli.js bypass on', { autonomy: 'high', protectedBranches: ['main'] });
    assert.equal(v.class, 'approval');
    assert.equal(v.rule, 'bypass-mode');
  });

  it('settings : bypassPermissions, règles deny/ask du framework retirées, celles de l\'utilisateur gardées ; retour propre', () => {
    const user: ClaudeSettings = { permissions: { deny: ['Read(./private/**)'], ask: ['Bash(make release)'] } };
    const on = mergeSettings(user, { autonomy: 'balanced', parallelism: 'subagents', bypass: true });
    assert.equal(on.permissions?.['defaultMode'], 'bypassPermissions');
    assert.deepEqual(on.permissions?.deny, ['Read(./private/**)']);
    assert.deepEqual(on.permissions?.ask, ['Bash(make release)']);
    const off = mergeSettings(on, { autonomy: 'balanced', parallelism: 'subagents' });
    assert.equal(off.permissions?.['defaultMode'], undefined);
    assert.ok(off.permissions?.deny?.includes('Read(./.env)'));
  });

  it('hooks : tout passe (secrets, .env, garde-fous, interdits), journalisé ; suppression précédée d\'un instantané', () => {
    const dir = sandbox('web-shop');
    dirs.push(dir);
    assert.equal(cli(dir, ['init', '--yes']).code, 0);
    type Out = { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string; additionalContext?: string } };
    const hook = (event: string, payload: Record<string, unknown>): Out => {
      const r = runtimeHook(dir, event, { session_id: 'bp', cwd: dir, ...payload });
      return r.stdout ? (JSON.parse(r.stdout) as Out) : {};
    };
    const bash = (command: string) => hook('guard-command', { tool_name: 'Bash', tool_input: { command } }).hookSpecificOutput;
    assert.equal(bash('cat .env')?.permissionDecision, 'deny', 'avant le bypass');

    assert.equal(cli(dir, ['bypass', 'on']).code, 0);
    const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')) as ClaudeSettings;
    assert.equal(settings.permissions?.['defaultMode'], 'bypassPermissions');
    assert.match(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), /BYPASS TOTAL/);
    assert.match(json<{ hookSpecificOutput: { additionalContext: string } }>(runtimeHook(dir, 'session-start', { source: 'startup' })).hookSpecificOutput.additionalContext, /BYPASS TOTAL/);

    for (const command of ['cat .env', 'vercel --prod', 'git push --force origin main', 'supabase db reset --linked']) {
      assert.equal(bash(command)?.permissionDecision, 'allow', command);
    }
    fs.writeFileSync(path.join(dir, 'old.txt'), 'x');
    const del = bash('rm old.txt');
    assert.equal(del?.permissionDecision, 'allow');
    assert.match(del?.permissionDecisionReason ?? '', /Instantané/);
    for (const file of ['.env', '.claude/settings.json', '.ceng/config.json']) {
      assert.equal(hook('guard-file', { tool_name: 'Write', tool_input: { file_path: path.join(dir, file) } }).hookSpecificOutput?.permissionDecision, 'allow', file);
    }
    assert.equal(hook('guard-mcp', { tool_name: 'mcp__supabase__execute_sql', tool_input: {} }).hookSpecificOutput?.permissionDecision, 'allow');
    const log = fs.readFileSync(new BrainPaths(dir).events, 'utf8');
    assert.match(log, /"rule":"bypass"/);

    assert.equal(cli(dir, ['bypass', 'off']).code, 0);
    assert.equal(bash('cat .env')?.permissionDecision, 'deny', 'garde-fous rétablis');
    const after = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')) as ClaudeSettings;
    assert.equal(after.permissions?.['defaultMode'], undefined);
  });

  it('une mise à jour du framework conserve le bypass (décision humaine)', () => {
    const dir = sandbox('web-shop');
    dirs.push(dir);
    assert.equal(cli(dir, ['init', '--yes']).code, 0);
    assert.equal(cli(dir, ['bypass', 'on']).code, 0);
    assert.equal(cli(dir, ['upgrade']).code, 0);
    assert.match(cli(dir, ['bypass', 'status']).stdout, /ACTIVÉ/);
  });
});
