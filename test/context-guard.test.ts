import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { cli, rm, runtimeHook, sandbox } from './helpers.js';

let dir = '';
let transcript = '';
const prompt = () => {
  const r = runtimeHook(dir, 'user-prompt', { prompt: 'on continue avec le paiement', transcript_path: transcript, session_id: 's1' });
  return r.stdout ? (JSON.parse(r.stdout).hookSpecificOutput?.additionalContext as string) : '';
};

before(() => {
  dir = sandbox('api-backend');
  assert.equal(cli(dir, ['init', '--yes']).code, 0);
  transcript = path.join(dir, 'transcript.jsonl');
  const cfgPath = path.join(dir, '.ceng/config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.contextGuard = { warnKb: 100 };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
});
after(() => rm(dir));

describe('alerte de contexte chargé (context rot)', () => {
  it('silencieux tant que la transcription est légère', () => {
    fs.writeFileSync(transcript, 'x'.repeat(10 * 1024));
    assert.equal(prompt(), '');
  });

  it('prévient une fois au premier palier, puis au second', () => {
    fs.writeFileSync(transcript, 'x'.repeat(150 * 1024));
    assert.match(prompt(), /Contexte chargé/);
    assert.equal(prompt(), '', 'une seule fois par palier');
    fs.writeFileSync(transcript, 'x'.repeat(250 * 1024));
    assert.match(prompt(), /Contexte chargé/);
  });

  it('deux compactions suffisent, et la garde se désactive', () => {
    runtimeHook(dir, 'session-start', { source: 'startup' });
    fs.writeFileSync(transcript, 'x');
    runtimeHook(dir, 'pre-compact', { trigger: 'auto' });
    assert.equal(prompt(), '');
    runtimeHook(dir, 'pre-compact', { trigger: 'auto' });
    assert.match(prompt(), /2 compaction/);
    runtimeHook(dir, 'session-start', { source: 'startup' });
    const cfgPath = path.join(dir, '.ceng/config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.contextGuard = { enabled: false };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    fs.writeFileSync(transcript, 'x'.repeat(900 * 1024));
    assert.equal(prompt(), '');
  });
});
