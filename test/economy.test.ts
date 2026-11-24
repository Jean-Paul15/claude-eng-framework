import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { estimateCosts } from '../src/app/costs.js';
import { comparePerf, parseMetrics } from '../src/app/perf.js';
import { cli, rm, sandbox } from './helpers.js';

describe('budgets de performance avec référence (S-03)', () => {
  it('lit les lignes clé=valeur', () => {
    assert.deepEqual(parseMetrics('build ok\nbundle_kb=412\n startup_ms = 830.5\nbruit: 3\n'), { bundle_kb: 412, startup_ms: 830.5 });
  });
  it('première mesure = référence ; régression > tolérance = échec ; amélioration = nouvelle référence', () => {
    const first = comparePerf({}, { bundle_kb: 400 }, 10);
    assert.ok(first.ok);
    assert.equal(first.next['bundle_kb']!.value, 400);
    const worse = comparePerf(first.next, { bundle_kb: 480 }, 10);
    assert.ok(!worse.ok);
    assert.match(worse.lines[0]!, /\+20 %/);
    const better = comparePerf(first.next, { bundle_kb: 380 }, 10);
    assert.ok(better.ok);
    assert.equal(better.next['bundle_kb']!.value, 380);
    assert.ok(comparePerf(first.next, { bundle_kb: 430 }, 10).ok, 'dans la tolérance');
  });
  it('budget absolu', () => assert.ok(!comparePerf({}, { bundle_kb: 600 }, 10, { bundle_kb: 500 }).ok));
});

describe('registre des coûts (S-04)', () => {
  it('estime la facture avec palier gratuit', () => {
    const e = estimateCosts([{ name: 'SMS', unit: 'sms', unitPriceUsd: 0.05, source: 'https://x', checkedAt: '2026-11-01', perActiveUserPerMonth: 2, freeTier: 500 }], 1000);
    assert.equal(e.lines[0]!.billable, 1500);
    assert.equal(e.totalUsd, 75);
  });
  let dir = '';
  before(() => {
    dir = sandbox('api-backend');
    assert.equal(cli(dir, ['init', '--yes']).code, 0);
  });
  after(() => rm(dir));
  it('ceng cost add / estimation / ready exige une ligne pour un service payant', () => {
    cli(dir, ['task', 'add', '--title', 'Envoi de SMS', '--kind', 'chore', '--domains', 'sms']);
    assert.match(cli(dir, ['ready']).stdout, /✖ Coûts de production connus/);
    assert.equal(cli(dir, ['cost', 'add', '--name', 'SMS', '--unit', 'sms', '--price', '0.05', '--per-user', '2', '--free', '500', '--source', 'https://exemple.test/tarifs']).code, 0);
    assert.match(cli(dir, ['cost', '--users', '1000']).stdout, /75 \$/);
    assert.match(cli(dir, ['ready']).stdout, /✔ Coûts de production connus/);
    const f = path.join(dir, '.ceng/config.json');
    const c = JSON.parse(fs.readFileSync(f, 'utf8'));
    c.costBudgetUsd = 50;
    fs.writeFileSync(f, JSON.stringify(c));
    assert.match(cli(dir, ['cost', '--users', '1000']).stdout, /Dépasse le budget/);
  });
  it('la gate performance compare à la référence', () => {
    const f = path.join(dir, '.ceng/config.json');
    const c = JSON.parse(fs.readFileSync(f, 'utf8'));
    c.commands.performance = 'node -e "console.log(\'bundle_kb=100\')"';
    c.commands.build = c.commands.typecheck = c.commands.lint = c.commands.unit = 'node -e "process.exit(0)"';
    fs.writeFileSync(f, JSON.stringify(c));
    cli(dir, ['task', 'add', '--title', 'Chemin chaud', '--kind', 'chore', '--domains', 'performance', '--risk', '4']);
    cli(dir, ['route', 'T-0002']);
    const run1 = cli(dir, ['gate', 'run', 'T-0002', '--only', 'performance']).stdout;
    assert.match(run1, /première mesure 100/);
    c.commands.performance = 'node -e "console.log(\'bundle_kb=150\')"';
    fs.writeFileSync(f, JSON.stringify(c));
    assert.match(cli(dir, ['gate', 'run', 'T-0002', '--only', 'performance']).stdout, /\+50 %/);
  });
});
