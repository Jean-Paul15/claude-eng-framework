import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { adapt } from '../src/domain/adaptation.js';
import type { FrameworkEvent } from '../src/domain/events.js';
import { selectGates } from '../src/domain/gates.js';
import { routeTask } from '../src/domain/routing.js';
import { policy, task } from './helpers.js';

const ev = (type: FrameworkEvent['type'], taskId?: string, data?: Record<string, unknown>): FrameworkEvent => ({ ts: '2026-01-01T00:00:00Z', type, ...(taskId ? { taskId } : {}), ...(data ? { data } : {}) });

describe('adaptation autonome bornée', () => {
  it('réduit le parallélisme quand les conflits se répètent', () => {
    const events = [
      ...Array.from({ length: 6 }, () => ev('plan.computed', undefined, { modes: ['parallel-subagents'] })),
      ev('conflict.detected'), ev('conflict.detected'), ev('conflict.detected'),
    ];
    const r = adapt({ events, tasks: [], policy: policy({ maxParallel: 3 }), installedSkills: [] });
    assert.equal(r.overrides.maxParallel, 2);
    assert.ok(r.overrides.reasons[0]!.includes('Conflits'));
  });

  it('relève la revue et avance Opus pour un type de tâche fragile', () => {
    const p = policy();
    const tasks = Array.from({ length: 6 }, (_, i) => {
      const t = task(`T-00${10 + i}`, { kind: 'migration', status: 'done' });
      t.route = routeTask(t, { policy: p });
      return t;
    });
    const events = [
      ...tasks.slice(0, 4).map((t) => ev('gate.result', t.id, { status: 'fail' })),
      ...tasks.slice(0, 3).map((t) => ev('escalation.opened', t.id)),
    ];
    const r = adapt({ events, tasks, policy: p, installedSkills: [] });
    assert.equal(r.overrides.reviewBump?.migration, 1);
    assert.ok(r.overrides.opusDesignKinds?.includes('migration'));
  });

  it('signale les skills dormantes après assez de sessions', () => {
    const events = [...Array.from({ length: 10 }, () => ev('session.start')), ev('skill.used', undefined, { skill: 'testing' })];
    const r = adapt({ events, tasks: [], policy: policy(), installedSkills: ['testing', 'performance', 'ceng-orchestrate'] });
    assert.deepEqual(r.dormantSkills, ['performance']);
  });

  it('n\'adapte rien sous le seuil d\'échantillon', () => {
    const r = adapt({ events: [ev('plan.computed', undefined, { modes: ['parallel-subagents'] }), ev('conflict.detected')], tasks: [], policy: policy(), installedSkills: [] });
    assert.equal(r.overrides.reasons.length, 0);
  });
});

describe('quality gates adaptatives', () => {
  it('docs : seulement la gate docs ; recherche : seulement un rapport', () => {
    const p = policy();
    assert.deepEqual(selectGates(task('T-1', { kind: 'docs' }), 'none', p, false).map((g) => g.gate), ['docs']);
    assert.deepEqual(selectGates(task('T-1', { kind: 'research' }), 'none', p, true).map((g) => g.gate), ['report']);
  });
  it('migration : gate migration requise ; données personnelles : compliance', () => {
    const p = policy();
    const g = selectGates(task('T-1', { kind: 'migration', domains: ['pii'], assessment: { risk: 3 } }), 'thorough', p, true).map((x) => x.gate);
    for (const id of ['migration', 'compliance', 'integration', 'security-review', 'report']) assert.ok(g.includes(id as never), id);
  });
});
