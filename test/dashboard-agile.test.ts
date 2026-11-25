import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { agentsOf, backlogOf, boardOf, cfdOf, funnelOf, ganttBars, groupSeriesOf, metricsOf, slowdownsOf, usageOf } from '../src/domain/dashboard-agile.js';
import { dailySeries } from '../src/domain/dashboard-state.js';
import type { FrameworkEvent } from '../src/domain/events.js';
import { task } from './helpers.js';

const NOW = new Date('2026-03-10T12:00:00Z');
const attempt = (startedAt: string, endedAt?: string, model = 'sonnet') => ({ n: 1, agent: 'x', model, startedAt, ...(endedAt ? { endedAt } : {}), outcome: 'success' }) as never;
const ev = (type: string, extra: Partial<FrameworkEvent> = {}): FrameworkEvent => ({ ts: '2026-03-10T10:00:00Z', type, ...extra }) as FrameworkEvent;

describe('tableau scrum et Gantt', () => {
  it('quatre colonnes ; bloquées et en échec ensemble ; colonnes longues tronquées', () => {
    const many = Array.from({ length: 33 }, (_, i) => task(`T-${100 + i}`, { createdAt: `2026-02-${String((i % 27) + 1).padStart(2, '0')}T00:00:00Z` }));
    const b = boardOf([...many, task('T-1', { status: 'in_progress' }), task('T-2', { status: 'blocked', blockedReason: 'secret manquant' }), task('T-3', { status: 'failed' }), task('T-4', { status: 'done' }), task('T-5', { status: 'cancelled' })]);
    assert.equal(b.pending.length, 30);
    assert.equal(b.hidden.pending, 3);
    assert.deepEqual(b.blocked.map((c) => c.id).sort(), ['T-2', 'T-3']);
    assert.equal(b.blocked.find((c) => c.id === 'T-2')!.reason, 'secret manquant');
    assert.deepEqual([b.in_progress.length, b.done.length], [1, 1]);
  });

  it('Gantt : dépendances gardées si la tâche existe, tâche en cours jusqu\'à maintenant', () => {
    const bars = ganttBars([
      task('T-1', { status: 'done', createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-03T00:00:00Z', attempts: [attempt('2026-03-02T00:00:00Z', '2026-03-03T00:00:00Z')] }),
      task('T-2', { status: 'in_progress', createdAt: '2026-03-03T00:00:00Z', deps: ['T-1', 'T-404'], attempts: [attempt('2026-03-09T00:00:00Z')] }),
    ], NOW, 'type');
    assert.deepEqual(bars.map((b) => [b.id, b.start, b.end]), [['T-1', '2026-03-02T00:00:00Z', '2026-03-03T00:00:00Z'], ['T-2', '2026-03-09T00:00:00Z', NOW.toISOString()]]);
    assert.deepEqual(bars[1]!.deps, ['T-1']);
  });
});

describe('mesures de projet', () => {
  const tasks = [
    task('T-1', { status: 'done', createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-09T00:00:00Z', attempts: [attempt('2026-03-07T00:00:00Z', '2026-03-09T00:00:00Z')] }),
    task('T-2', { status: 'done', createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-05T00:00:00Z', attempts: [attempt('2026-03-04T00:00:00Z', '2026-03-05T00:00:00Z')] }),
    task('T-3', { createdAt: '2026-03-02T00:00:00Z' }),
    task('T-4', { status: 'blocked', createdAt: '2026-03-02T00:00:00Z' }),
  ];

  it('débit, durée médiane, en cours et date de fin prévue', () => {
    const m = metricsOf(tasks, dailySeries(tasks, NOW), NOW);
    assert.equal(m.doneLast7, 2);
    assert.equal(m.open, 2);
    assert.equal(m.blocked, 1);
    assert.equal(m.cycleMedianHours, 36);
    assert.equal(m.perWeek, 0.5);
    assert.equal(m.forecast?.days, 28, '2 restantes à 2 tâches par 28 jours');
    assert.equal(m.forecast?.date, '2026-04-07');
  });

  it('pas de prévision sans rythme', () => {
    assert.equal(metricsOf([task('T-1')], dailySeries([task('T-1')], NOW), NOW).forecast, undefined);
  });

  it('entonnoir : « sans dérogation » exclut les tâches dispensées', () => {
    const f = funnelOf([task('T-1', { status: 'done' }), task('T-2', { status: 'done', waiver: 'démo' }), task('T-3', { status: 'in_progress' }), task('T-4')]);
    assert.deepEqual(f, { created: 4, started: 3, done: 2, clean: 1 });
  });
});

describe('backlog en bandes', () => {
  it('maintenant, ensuite (prêtes), plus tard (attendent), humain', () => {
    const b = backlogOf([
      task('T-1', { status: 'in_progress' }),
      task('T-2', { status: 'done' }),
      task('T-3', { deps: ['T-2'] }),
      task('T-4', { deps: ['T-1'] }),
      task('T-5', { deps: ['T-3'] }),
      task('T-6', { status: 'blocked', blockedReason: 'approbation' }),
    ], 'type');
    assert.deepEqual(b.now.map((i) => i.id), ['T-1']);
    assert.deepEqual(b.next.map((i) => i.id), ['T-3']);
    assert.deepEqual(b.later.map((i) => [i.id, i.waitingFor]), [['T-4', ['T-1']], ['T-5', ['T-3']]]);
    assert.deepEqual(b.human.map((i) => i.reason), ['approbation']);
    assert.equal(b.next[0]!.unlocks, 1);
  });
});

describe('flux cumulé, ralentissements, agents, jetons', () => {
  it('rejoue le journal : l\'état de chaque tâche à la fin de chaque jour', () => {
    const t = [task('T-1', { status: 'done', createdAt: '2026-03-08T00:00:00Z' })];
    const events = [ev('task.created', { taskId: 'T-1', ts: '2026-03-08T01:00:00Z' }), ev('task.started', { taskId: 'T-1', ts: '2026-03-09T01:00:00Z' }), ev('task.done', { taskId: 'T-1', ts: '2026-03-10T01:00:00Z' })];
    const c = cfdOf(t, events, NOW, 4);
    assert.deepEqual(c.map((p) => [p.day, p.pending, p.in_progress, p.done]), [['2026-03-07', 0, 0, 0], ['2026-03-08', 1, 0, 0], ['2026-03-09', 0, 1, 0], ['2026-03-10', 0, 0, 1]]);
  });

  it('tâches à l\'arrêt (bloquées, ou « en cours » oubliées) et contrôles qui échouent', () => {
    const g = (gate: string, status: string) => ({ gate, status, required: true, at: '2026-03-01' }) as never;
    const s = slowdownsOf([
      task('T-1', { status: 'blocked', updatedAt: '2026-03-01T12:00:00Z', blockedReason: 'secret' }),
      task('T-2', { status: 'in_progress', updatedAt: '2026-03-10T11:00:00Z', attempts: [attempt('2026-03-10T11:00:00Z')] }),
      task('T-3', { status: 'in_progress', updatedAt: '2026-02-01T00:00:00Z', attempts: [attempt('2026-02-01T00:00:00Z')] }),
      task('T-4', { gates: [g('unit', 'fail'), g('lint', 'pass')] }),
    ], NOW);
    assert.deepEqual(s.stuck.map((x) => [x.id, x.days]), [['T-3', 38], ['T-1', 9]]);
    assert.deepEqual(s.gates, [{ gate: 'unit', fail: 1, total: 1 }]);
  });

  it('agents : en cours = lancés sans arrêt ; bilan par type avec les jetons réels', () => {
    const a = agentsOf([
      ev('agent.spawn', { agentId: 'a1', agentType: 'ceng-engineer', model: 'sonnet', taskId: 'T-1', ts: '2026-03-10T09:00:00Z' }),
      ev('agent.spawn', { agentId: 'a2', agentType: 'ceng-reviewer', ts: '2026-03-10T09:30:00Z' }),
      ev('agent.stop', { agentId: 'a2', agentType: 'ceng-reviewer', data: { usage: { model: 'claude-opus-5-5', input: 100, output: 50 } } }),
    ], NOW);
    assert.deepEqual(a.running.map((r) => [r.type, r.taskId]), [['ceng-engineer', 'T-1']]);
    assert.deepEqual(a.stats.find((s) => s.type === 'ceng-reviewer'), { type: 'ceng-reviewer', runs: 1, tokens: 150 });
  });

  it('jetons par jour et par modèle', () => {
    const u = usageOf([ev('agent.stop', { data: { usage: { model: 'claude-sonnet-5-5', input: 10, output: 5, cacheRead: 1000, cacheWrite: 3 } } })], NOW, 3);
    assert.deepEqual(u.days.map((d) => d.sonnet), [0, 0, 15]);
    assert.deepEqual(u.totals, { input: 10, output: 5, cacheRead: 1000, cacheWrite: 3 });
  });

  it('séries par chantier : le reste à faire jour après jour', () => {
    const t = [task('T-1', { group: 'a', createdAt: '2026-03-01T00:00:00Z', status: 'done', updatedAt: '2026-03-09T10:00:00Z' }), task('T-2', { group: 'a', createdAt: '2026-03-01T00:00:00Z' }), task('T-3', { group: 'b', createdAt: '2026-03-01T00:00:00Z' }), task('T-4', { group: 'c', createdAt: '2026-03-01T00:00:00Z' })];
    const s = groupSeriesOf(t, 'chantier', NOW);
    assert.equal(s.days.length, 30);
    const a = s.series.find((x) => x.name === 'a')!.remaining;
    assert.deepEqual([a[27], a[28], a[29]], [2, 1, 1]);
  });
});
