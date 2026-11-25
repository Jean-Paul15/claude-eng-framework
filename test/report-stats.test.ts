import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { attemptsByModel, doneOverTime, gateTallies, groupProgress, statusCounts } from '../src/domain/report-stats.js';
import { renderReport } from '../src/generation/report-html.js';
import { task } from './helpers.js';

const done = (id: string, at: string, over: Parameters<typeof task>[1] = {}) => task(id, { status: 'done', updatedAt: at, ...over });

describe('chiffres du tableau de bord', () => {
  it('compte les états sans les tâches annulées', () => {
    const c = statusCounts([done('T-1', '2026-01-01'), task('T-2', { status: 'blocked' }), task('T-3', { status: 'cancelled' }), task('T-4')]);
    assert.deepEqual(c, { done: 1, in_progress: 0, pending: 1, blocked: 1, failed: 0 });
  });

  it('regroupe par chantier s\'il y en a au moins trois, sinon par type', () => {
    const grouped = ['a', 'b', 'c'].map((g, i) => task(`T-${i}`, { group: g }));
    assert.equal(groupProgress(grouped).by, 'chantier');
    const flat = [task('T-1', { kind: 'bug' }), done('T-2', '2026-01-01', { kind: 'bug' }), task('T-3', { kind: 'ui' })];
    const r = groupProgress(flat);
    assert.equal(r.by, 'type');
    assert.deepEqual(r.rows[0], { group: 'bug', done: 1, total: 2 });
  });

  it('terminées dans le temps : zéros entre les jours, semaines au-delà de 45 jours', () => {
    const days = doneOverTime([done('T-1', '2026-01-01T10:00:00Z'), done('T-2', '2026-01-01T12:00:00Z'), done('T-3', '2026-01-04T09:00:00Z')]);
    assert.equal(days.unit, 'jour');
    assert.deepEqual(days.buckets.map((b) => b.count), [2, 0, 0, 1]);
    const weeks = doneOverTime([done('T-1', '2026-01-01T10:00:00Z'), done('T-2', '2026-03-01T10:00:00Z')]);
    assert.equal(weeks.unit, 'semaine');
    assert.equal(weeks.buckets[0]!.count, 1);
    assert.deepEqual(doneOverTime([task('T-1')]).buckets, []);
  });

  it('contrôles : réussi, échec, dispensé, autre', () => {
    const g = (gate: string, status: string) => ({ gate, status, required: true, at: '2026-01-01' }) as never;
    const t = gateTallies([task('T-1', { gates: [g('unit', 'pass'), g('lint', 'fail')] }), task('T-2', { gates: [g('unit', 'waived'), g('lint', 'pending')] })]);
    assert.deepEqual(t.find((x) => x.gate === 'unit'), { gate: 'unit', pass: 1, fail: 0, waived: 1, other: 0 });
    assert.deepEqual(t.find((x) => x.gate === 'lint'), { gate: 'lint', pass: 0, fail: 1, waived: 0, other: 1 });
  });

  it('tentatives par modèle', () => {
    const a = (model: string) => ({ n: 1, agent: 'x', model, startedAt: '2026-01-01', outcome: 'success' }) as never;
    assert.deepEqual(attemptsByModel([task('T-1', { attempts: [a('opus'), a('sonnet'), a('sonnet')] })]), { opus: 1, sonnet: 2, haiku: 0 });
  });
});

describe('page du tableau de bord', () => {
  const html = renderReport({ project: 'p', generatedAt: '2026-01-01T00:00:00Z', tasks: [done('T-1', '2026-01-01T00:00:00Z'), task('T-2')], features: [], inbox: [], shots: {} });
  it('graphiques, relief 3D et aucune ressource externe', () => {
    assert.match(html, /<canvas class="relief"/);
    assert.match(html, /<svg class="donut"/);
    assert.match(html, /<svg class="chart"/);
    assert.match(html, /prefers-reduced-motion/);
    assert.ok(!/https?:\/\//.test(html));
  });
  it('sans JavaScript les chiffres restent écrits dans la page', () => {
    assert.match(html, /<b data-count="1">1<\/b>/);
  });
});
