import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { familyOf, readUsage } from '../src/app/usage.js';
import { cli, json, rm, runtimeHook, sandbox } from './helpers.js';

let dir = '';
let transcript = '';
const line = (id: string, model: string, usage: Record<string, number>) => JSON.stringify({ type: 'assistant', message: { id, model, usage } });

before(() => {
  dir = sandbox('api-backend');
  assert.equal(cli(dir, ['init', '--yes']).code, 0);
  transcript = path.join(dir, 'agent-1.jsonl');
  fs.writeFileSync(transcript, [
    line('m1', 'claude-sonnet-5-5', { input_tokens: 2, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 4000 }),
    line('m1', 'claude-sonnet-5-5', { input_tokens: 2, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 4000 }),
    JSON.stringify({ type: 'user', message: { content: 'sans usage' } }),
    'ligne illisible {',
    line('m2', 'claude-sonnet-5-5', { input_tokens: 3, output_tokens: 250, cache_read_input_tokens: 4000, cache_creation_input_tokens: 200 }),
  ].join('\n'));
});
after(() => rm(dir));

describe('jetons réels des sous-agents (D-5)', () => {
  it('somme par message (doublons écartés), ignore les lignes sans usage ou illisibles', () => {
    assert.deepEqual(readUsage(transcript), { model: 'claude-sonnet-5-5', messages: 2, input: 5, output: 350, cacheRead: 4000, cacheWrite: 4200 });
    assert.equal(readUsage(path.join(dir, 'inexistant.jsonl')), undefined);
    assert.equal(familyOf('claude-haiku-5-5'), 'haiku');
  });

  it('SubagentStop consigne l\'usage, ceng report l\'affiche par famille de modèle et par tâche', () => {
    cli(dir, ['task', 'add', '--title', 'Un', '--kind', 'chore']);
    runtimeHook(dir, 'subagent-stop', { agent_id: 'a1', agent_type: 'ceng-builder', last_assistant_message: 'CENG_REPORT', agent_transcript_path: transcript });
    const r = json<{ tokens: Record<string, { input: number; output: number; agents: number }> }>(cli(dir, ['report', '--json']));
    assert.equal(r.tokens['sonnet']!.output, 350);
    assert.equal(r.tokens['sonnet']!.agents, 1);
    assert.match(cli(dir, ['report']).stdout, /Jetons réels des sous-agents : sonnet 1 agent\(s\)/);
  });

  it('transcription absente : rien ne casse', () => {
    const r = runtimeHook(dir, 'subagent-stop', { agent_id: 'a2', agent_type: 'ceng-builder', last_assistant_message: 'CENG_REPORT', agent_transcript_path: '/inexistant.jsonl' });
    assert.equal(r.code, 0);
  });
});
