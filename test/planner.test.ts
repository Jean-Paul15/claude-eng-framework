import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { globsOverlap, matchesGlob } from '../src/domain/globs.js';
import { planExecution } from '../src/domain/planner.js';
import { findCycle, readyTasks } from '../src/domain/taskgraph.js';
import { policy, task } from './helpers.js';

describe('globs et propriété de fichiers', () => {
  it('correspondance', () => {
    assert.ok(matchesGlob('src/a/b.ts', 'src/**/*.ts'));
    assert.ok(matchesGlob('src/b.ts', 'src/**/*.ts'));
    assert.ok(!matchesGlob('lib/b.ts', 'src/**'));
    assert.ok(matchesGlob('app/x.tsx', 'app/*.{ts,tsx}'));
  });
  it('recouvrement conservateur', () => {
    assert.ok(globsOverlap('src/api/**', 'src/api/orders.ts'));
    assert.ok(globsOverlap('src/**', 'src/web/**'));
    assert.ok(!globsOverlap('src/api/**', 'src/web/**'));
    assert.ok(!globsOverlap('a.ts', 'b.ts'));
  });
});

describe('graphe de tâches', () => {
  it('tâches prêtes et cycles', () => {
    const tasks = [task('T-0001', { status: 'done' }), task('T-0002', { deps: ['T-0001'] }), task('T-0003', { deps: ['T-0002'] })];
    assert.deepEqual(readyTasks(tasks).map((t) => t.id), ['T-0002']);
    assert.equal(findCycle(tasks), null);
    assert.ok(findCycle([task('T-0001', { deps: ['T-0002'] }), task('T-0002', { deps: ['T-0001'] })]));
  });
});

describe('planification du parallélisme', () => {
  const ctx = (over: Parameters<typeof policy>[0] = {}, teamsAvailable = false) => ({ policy: policy(over), teamsAvailable });

  it('une seule tâche : séquentiel (jamais d\'agents inutiles)', () => {
    const plan = planExecution([task('T-0001', { files: ['src/a/**'], assessment: { complexity: 3 } })], ctx());
    assert.equal(plan.batches.length, 1);
    assert.equal(plan.batches[0]!.mode, 'sequential');
  });

  it('tâches indépendantes et substantielles : subagents parallèles', () => {
    const plan = planExecution([
      task('T-0001', { files: ['web/**'], assessment: { complexity: 3 } }),
      task('T-0002', { files: ['api/**'], assessment: { complexity: 3 } }),
      task('T-0003', { files: ['docs/**'], kind: 'docs', assessment: { complexity: 2 } }),
    ], ctx());
    const b = plan.batches.find((x) => x.mode === 'parallel-subagents');
    assert.ok(b);
    assert.equal(b.tasks.length, 3);
  });

  it('fichiers en recouvrement : jamais dans le même lot', () => {
    const plan = planExecution([
      task('T-0001', { files: ['src/**'], assessment: { complexity: 3 } }),
      task('T-0002', { files: ['src/api/x.ts'], assessment: { complexity: 3 } }),
    ], ctx());
    assert.equal(plan.batches[0]!.mode, 'sequential');
    assert.ok(plan.deferred.some((d) => d.task === 'T-0002' && d.reason.includes('recouvrement')));
  });

  it('tâches triviales : faites directement, sans agent', () => {
    const plan = planExecution([task('T-0001', { kind: 'chore', assessment: { complexity: 1, risk: 1, ambiguity: 1, contextSize: 'S' } })], ctx());
    assert.equal(plan.batches[0]!.mode, 'direct');
  });

  it('Agent Team seulement si ≥ 3 tâches, contrat partagé, teams disponibles et budget ≠ economy', () => {
    const tasks = [
      task('T-0001', { files: ['web/**'], interfaces: ['api:/orders'], assessment: { complexity: 3 } }),
      task('T-0002', { files: ['api/**'], interfaces: ['api:/orders'], assessment: { complexity: 3 } }),
      task('T-0003', { files: ['e2e/**'], interfaces: ['api:/orders'], kind: 'test', assessment: { complexity: 3 } }),
    ];
    assert.equal(planExecution(tasks, ctx({ parallelism: 'teams' }, true)).batches[0]!.mode, 'agent-team');
    assert.equal(planExecution(tasks, ctx({ parallelism: 'teams', budget: 'economy' }, true)).batches[0]!.mode, 'parallel-subagents');
    assert.equal(planExecution(tasks, ctx({ parallelism: 'teams' }, false)).batches[0]!.mode, 'parallel-subagents');
    assert.equal(planExecution(tasks, ctx({ parallelism: 'subagents' }, true)).batches[0]!.mode, 'parallel-subagents');
    const noContract = tasks.map((t) => ({ ...t, interfaces: [] }));
    assert.equal(planExecution(noContract, ctx({ parallelism: 'teams' }, true)).batches[0]!.mode, 'parallel-subagents');
  });

  it('respecte maxParallel et l\'adaptation après conflits', () => {
    const tasks = ['a', 'b', 'c', 'd'].map((d, i) => task(`T-000${i + 1}`, { files: [`${d}/**`], assessment: { complexity: 3 } }));
    assert.equal(planExecution(tasks, ctx({ maxParallel: 2 })).batches[0]!.tasks.length, 2);
    const adapted = planExecution(tasks, { policy: policy(), teamsAvailable: false, overrides: { maxParallel: 1, reasons: [], updatedAt: 'x' } });
    assert.equal(adapted.batches[0]!.mode, 'sequential');
  });

  it('périmètre non déclaré : isolement en worktree', () => {
    const plan = planExecution([
      task('T-0001', { files: [], assessment: { complexity: 3 } }),
      task('T-0002', { files: ['api/**'], assessment: { complexity: 3 } }),
    ], ctx());
    assert.equal(plan.batches[0]!.isolation, 'worktree');
  });

  it('chemin critique prioritaire', () => {
    const tasks = [
      task('T-0001', { files: ['a/**'], assessment: { complexity: 3 } }),
      task('T-0002', { files: ['a/x/**'], assessment: { complexity: 3 } }),
      task('T-0003', { deps: ['T-0002'] }),
      task('T-0004', { deps: ['T-0003'] }),
    ];
    const plan = planExecution(tasks, ctx({ parallelism: 'off' }));
    assert.equal(plan.batches[0]!.tasks[0], 'T-0002');
  });
});
