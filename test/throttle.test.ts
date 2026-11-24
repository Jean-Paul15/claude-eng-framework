import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { activeThrottle, isUsageLimit, shouldAbortResume, waitUntilReset } from '../src/app/throttle.js';
import { BrainStore } from '../src/brain/store.js';
import { cli, rm, runtimeHook, sandbox } from './helpers.js';

let dir = '';
let store: BrainStore;
const run = (...a: string[]) => cli(dir, a);

before(() => {
  dir = sandbox('api-backend');
  assert.equal(cli(dir, ['init', '--yes']).code, 0);
  store = new BrainStore(dir);
});
after(() => rm(dir));

describe('frein de limite d\'usage et reprise automatique (N-09)', () => {
  it('reconnaît une limite d\'usage, pas une surcharge', () => {
    assert.ok(isUsageLimit('rate_limit') && isUsageLimit('usage_limit_reached'));
    assert.ok(!isUsageLimit('overloaded') && !isUsageLimit('server_error'));
  });

  it('StopFailure pose le frein ; le routage devient économe et le dit ; le brief l\'annonce', () => {
    run('task', 'add', '--title', 'Nettoyage', '--kind', 'chore');
    const normal = JSON.parse(run('route', 'T-0001', '--json').stdout) as { reasons: string[] };
    assert.ok(!normal.reasons.some((r) => r.includes('Frein')));
    runtimeHook(dir, 'stop-failure', { error_type: 'rate_limit' });
    assert.ok(activeThrottle(store));
    const throttled = JSON.parse(run('route', 'T-0001', '--json').stdout) as { reasons: string[] };
    assert.match(throttled.reasons[0]!, /Frein de limite d'usage actif/);
    const brief = JSON.parse(runtimeHook(dir, 'session-start', { source: 'resume' }).stdout).hookSpecificOutput.additionalContext as string;
    assert.match(brief, /Frein de limite d'usage actif/);
  });

  it('une surcharge ne pose pas de frein ; config throttle off le lève', () => {
    run('config', 'throttle', 'off');
    assert.equal(activeThrottle(store), undefined);
    runtimeHook(dir, 'stop-failure', { error_type: 'overloaded' });
    assert.equal(activeThrottle(store), undefined);
  });

  it('attente jusqu\'à la réinitialisation (marge comprise), sinon l\'attente par défaut', () => {
    assert.equal(waitUntilReset(store, 900_000), 900_000);
    runtimeHook(dir, 'stop-failure', { error_type: 'rate_limit' });
    const wait = waitUntilReset(store, 900_000);
    assert.ok(wait > 4.9 * 3_600_000 && wait < 5.1 * 3_600_000);
  });

  it('reprise automatique : désactivée par défaut (rien de programmé), activable ; annulée si l\'humain a repris', () => {
    assert.equal(store.state().resumeAt, undefined);
    assert.match(run('config', 'auto-resume').stdout, /désactivée/);
    assert.match(run('config', 'auto-resume', 'on').stdout, /activée/);
    assert.equal(shouldAbortResume(store), false);
    const sf = path.join(dir, '.ceng/brain/state.json');
    const s = JSON.parse(fs.readFileSync(sf, 'utf8'));
    s.interruption = { type: 'rate_limit', at: '2026-01-01T00:00:00.000Z' };
    s.lastSessionAt = '2026-01-01T01:00:00.000Z';
    fs.writeFileSync(sf, JSON.stringify(s));
    assert.equal(shouldAbortResume(new BrainStore(dir)), true);
    run('config', 'auto-resume', 'off');
  });
});
