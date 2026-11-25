import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildDashboardState, dailySeries, feed } from '../src/domain/dashboard-state.js';
import { attemptsByModel, gateTallies, groupProgress, statusCounts } from '../src/domain/report-stats.js';
import type { FrameworkEvent } from '../src/domain/events.js';
import { task } from './helpers.js';

const NOW = new Date('2026-03-10T12:00:00Z');
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

describe('état du tableau de bord', () => {
  it('série par jour : 84 jours, zéros compris, cumuls partant de l\'avant-fenêtre', () => {
    const tasks = [
      done('T-0', '2025-01-01T00:00:00Z', { createdAt: '2025-01-01T00:00:00Z' }),
      done('T-1', '2026-03-10T09:00:00Z', { createdAt: '2026-03-09T09:00:00Z' }),
      task('T-2', { createdAt: '2026-03-10T10:00:00Z' }),
    ];
    const d = dailySeries(tasks, NOW);
    assert.equal(d.length, 84);
    assert.equal(d[83]!.day, '2026-03-10');
    assert.deepEqual([d[82]!.created, d[83]!.created, d[83]!.done], [1, 1, 1]);
    assert.deepEqual([d[0]!.doneCum, d[0]!.createdCum], [1, 1], 'la tâche ancienne compte dans le point de départ');
    assert.deepEqual([d[83]!.doneCum, d[83]!.createdCum], [2, 3]);
  });

  it('fil d\'activité : phrases lisibles, bruit écarté, plus récent d\'abord', () => {
    const ev = (type: string, taskId?: string, data?: Record<string, unknown>): FrameworkEvent => ({ ts: '2026-03-10T10:00:00Z', type, ...(taskId ? { taskId } : {}), ...(data ? { data } : {}) }) as FrameworkEvent;
    const items = feed([ev('task.started', 'T-1'), ev('file.edited', 'T-1'), ev('guard.verdict'), ev('gate.result', 'T-1', { gate: 'unit', status: 'fail' }), ev('task.done', 'T-1')], new Map([['T-1', 'Page']]));
    assert.deepEqual(items.map((i) => i.text), ['T-1 · Page terminée', 'Contrôle unit en échec sur T-1', 'T-1 · Page démarrée']);
    assert.deepEqual(items.map((i) => i.tone), ['good', 'warn', 'info']);
  });

  it('assemble tout : attente, fonctionnalités, activité', () => {
    const s = buildDashboardState({
      project: 'p', now: NOW, tasks: [done('T-1', '2026-03-10T09:00:00Z'), task('T-2')], events: [], closedIncrements: [], activity: { last: '2026-03-10T11:59:50Z', total: 7 },
      featureStatuses: ['delivered', 'delivered', 'decided'], waiting: [{ level: 'blocking', source: 'approval', question: 'a' }, { level: 'confirm', source: 'decision', question: 'b' }], shots: {},
    });
    assert.equal(s.total, 2);
    assert.deepEqual([s.waiting.total, s.waiting.blocking, s.waiting.confirm, s.waiting.bySource], [2, 1, 1, { approval: 1, decision: 1 }]);
    assert.deepEqual(s.features, { delivered: 2, decided: 1 });
    assert.equal(s.activity.total, 7);
  });
});
