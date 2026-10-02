import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { routeTask } from '../src/domain/routing.js';
import { policy, task } from './helpers.js';

const route = (t: Parameters<typeof routeTask>[0], p = policy()) => routeTask(t, { policy: p, now: 'x' });

describe('routage de modèles et d\'exécution', () => {
  it('tâche triviale : exécution directe, pas de revue, pas d\'agent', () => {
    const r = route(task('T-0001', { kind: 'chore', assessment: { complexity: 1, risk: 1, ambiguity: 1, contextSize: 'S' } }));
    assert.equal(r.executor, 'direct');
    assert.equal(r.reviewLevel, 'none');
    assert.ok(!r.phases.some((p) => p.step === 'design'));
  });

  it('tâche mécanique déléguée à Haiku quand elle n\'est pas triviale en contexte', () => {
    const r = route(task('T-0001', { kind: 'chore', assessment: { complexity: 1, risk: 1, ambiguity: 1, contextSize: 'M' } }));
    assert.equal(r.implementer.model, 'haiku');
    assert.equal(r.executor, 'subagent');
  });

  it('fonctionnalité définie et moyenne : Sonnet/builder, revue ciblée', () => {
    const r = route(task('T-0001', { assessment: { complexity: 3, risk: 2, ambiguity: 2 } }));
    assert.equal(r.implementer.model, 'sonnet');
    assert.equal(r.implementer.agent, 'ceng-builder');
    assert.equal(r.reviewLevel, 'targeted');
    assert.ok(!r.phases.some((p) => p.model === 'opus'));
  });

  it('forte ambiguïté : conception Opus, implémentation Sonnet (Opus ne code pas)', () => {
    const r = route(task('T-0001', { assessment: { complexity: 4, risk: 3, ambiguity: 5, architecturalImpact: 4 } }));
    const design = r.phases.find((p) => p.step === 'design');
    assert.equal(design?.agent, 'ceng-principal');
    assert.equal(design?.model, 'opus');
    assert.equal(r.implementer.model, 'sonnet');
    assert.equal(r.implementer.agent, 'ceng-engineer');
  });

  it('budget economy : relève les seuils d\'Opus hors domaine critique', () => {
    const t = task('T-0001', { assessment: { complexity: 3, risk: 2, ambiguity: 4 } });
    assert.ok(route(t, policy({ budget: 'balanced' })).phases.some((p) => p.step === 'design'));
    assert.ok(!route(t, policy({ budget: 'economy' })).phases.some((p) => p.step === 'design'));
  });

  it('budget economy + paiements : les planchers critiques s\'appliquent malgré l\'économie', () => {
    const p = policy({ budget: 'economy' }, ['payments'], 'critical');
    assert.deepEqual(p.criticalDomains, ['payments']);
    assert.ok(p.notes.some((n) => n.includes('stratégie économique est conservée')));
    const r = route(task('T-0001', { domains: ['payments'], assessment: { complexity: 3, risk: 3, ambiguity: 2 } }), p);
    assert.equal(r.reviewLevel, 'critical');
    assert.ok(r.gates.some((g) => g.gate === 'security-review' && g.required));
    assert.ok(r.gates.some((g) => g.gate === 'integration' && g.required));
    assert.ok(r.phases.some((p2) => p2.step === 'threat-model' && p2.model === 'opus'));
    assert.ok(r.testStrategy.testFirst);
    assert.ok(r.testStrategy.types.includes('property'));
    assert.ok(['high', 'xhigh'].includes(r.implementer.effort), 'effort jamais réduit en domaine critique');
  });

  it('bug : test de régression d\'abord', () => {
    const r = route(task('T-0001', { kind: 'bug', assessment: { complexity: 2, risk: 2 } }));
    assert.ok(r.testStrategy.testFirst);
    assert.match(r.testStrategy.flow, /régression/);
  });

  it('UI exploratoire : pas de TDD forcé, accessibilité requise', () => {
    const r = route(task('T-0001', { kind: 'ui', domains: ['frontend'], assessment: { complexity: 3, risk: 2 } }));
    assert.equal(r.testStrategy.testFirst, false);
    assert.ok(r.gates.some((g) => g.gate === 'accessibility'));
  });

  it('UI avec direction créative : exécutant frontend dédié', () => {
    const r = routeTask(task('T-0001', { kind: 'ui', assessment: { complexity: 3 } }), { policy: policy(), hasCreativeDirection: true });
    assert.equal(r.implementer.agent, 'ceng-frontend-executor');
  });

  it('escalade : après 2 échecs Sonnet → ESCALATE_TO_OPUS ; après échec Opus → humain', () => {
    const fail = (n: number, model: 'sonnet' | 'opus') => ({ n, agent: 'ceng-builder', model, startedAt: 'x', outcome: 'failure' as const, reason: 'tests rouges' });
    const r1 = route(task('T-0001', { attempts: [fail(1, 'sonnet')] }));
    assert.equal(r1.escalate.required, false);
    const r2 = route(task('T-0001', { attempts: [fail(1, 'sonnet'), fail(2, 'sonnet')] }));
    assert.equal(r2.escalate.required, true);
    assert.equal(r2.escalate.to, 'ceng-principal');
    assert.equal(r2.implementer.model, 'opus');
    const r3 = route(task('T-0001', { attempts: [fail(1, 'sonnet'), fail(2, 'sonnet'), fail(3, 'opus')] }));
    assert.equal(r3.escalate.to, 'human');
    assert.equal(r3.humanApproval.required, true);
  });

  it('chaque décision est expliquée et a un coût relatif croissant avec le risque', () => {
    const small = route(task('T-0001', { assessment: { complexity: 2, risk: 1 } }));
    const big = route(task('T-0002', { domains: ['payments'], assessment: { complexity: 4, risk: 4, ambiguity: 4 } }), policy({}, ['payments'], 'critical'));
    assert.ok(small.reasons.length > 0 && big.reasons.length > 0);
    assert.ok(big.costIndex > small.costIndex * 3, `${big.costIndex} vs ${small.costIndex}`);
  });

  it('licence : approbation humaine requise', () => {
    const r = route(task('T-0001', { kind: 'chore', domains: ['licensing', 'dependencies'], assessment: { complexity: 2 } }));
    assert.equal(r.humanApproval.required, true);
    assert.ok(r.gates.some((g) => g.gate === 'compliance' && g.required));
  });

  it('adaptation : revue relevée pour un type de tâche qui échoue souvent', () => {
    const t = task('T-0001', { kind: 'bug', assessment: { complexity: 2, risk: 2 } });
    const base = routeTask(t, { policy: policy() });
    const bumped = routeTask(t, { policy: policy(), overrides: { reviewBump: { bug: 1 }, reasons: [], updatedAt: 'x' } });
    assert.notEqual(base.reviewLevel, bumped.reviewLevel);
  });
});
