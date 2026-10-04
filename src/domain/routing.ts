import { selectGates } from './gates.js';
import { SECURITY_SENSITIVE_DOMAINS } from './policy.js';
import type {
  AdaptiveOverrides, Effort, EffectivePolicy, Level, ModelTier, Phase, ReviewLevel, RouteDecision, Task, TestStrategy,
} from './types.js';

/**
 * Moteur de routage : « la plus petite quantité d'intelligence, de contexte et d'agents
 * suffisante pour la qualité requise » — sauf quand le risque impose des planchers.
 *
 * Pur et déterministe : l'orchestrateur (LLM) fournit le jugement (l'évaluation de la tâche),
 * cette politique en déduit une décision explicable, testable et constante d'une session à l'autre.
 */

export interface RoutingContext {
  policy: EffectivePolicy;
  overrides?: AdaptiveOverrides;
  /** Le projet possède une direction créative (docs de référence produits par creative-director). */
  hasCreativeDirection?: boolean;
  now?: string;
}

/** Poids relatifs de coût par modèle (ordre de grandeur des prix catalogue, Haiku = 1). */
const MODEL_WEIGHT: Record<ModelTier, number> = { haiku: 1, sonnet: 3, opus: 5 };
const EFFORT_WEIGHT: Record<Effort, number> = { low: 0.6, medium: 1, high: 1.6, xhigh: 2.4 };
const CONTEXT_WEIGHT = { S: 1, M: 2, L: 4 } as const;
/** Surcoût fixe d'un subagent (prompt système + CLAUDE.md + brief) exprimé en unités de contexte S. */
const SPAWN_OVERHEAD = 1;

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh'];
const REVIEWS: ReviewLevel[] = ['none', 'targeted', 'thorough', 'critical'];

const clampLevel = (n: number): number => Math.max(1, Math.min(5, n));
const shiftEffort = (e: Effort, delta: number): Effort =>
  EFFORTS[Math.max(0, Math.min(EFFORTS.length - 1, EFFORTS.indexOf(e) + delta))]!;
const shiftReview = (r: ReviewLevel, delta: number): ReviewLevel =>
  REVIEWS[Math.max(0, Math.min(REVIEWS.length - 1, REVIEWS.indexOf(r) + delta))]!;

export function isCritical(task: Task, policy: EffectivePolicy): boolean {
  return task.assessment.risk >= 5 || task.domains.some((d) => policy.criticalDomains.includes(d));
}

export function isSecuritySensitive(task: Task): boolean {
  return task.kind === 'security' || task.domains.some((d) => (SECURITY_SENSITIVE_DOMAINS as readonly string[]).includes(d));
}

export function isTrivial(task: Task): boolean {
  const a = task.assessment;
  return a.complexity <= 1 && a.risk <= 2 && a.ambiguity <= 2 && a.contextSize === 'S';
}

function failedAttempts(task: Task): number {
  return task.attempts.filter((t) => t.outcome === 'failure').length;
}

function opusFailed(task: Task): boolean {
  return task.attempts.some((t) => t.model === 'opus' && t.outcome === 'failure');
}

export function routeTask(task: Task, ctx: RoutingContext): RouteDecision {
  const { policy } = ctx;
  const a = task.assessment;
  const reasons: string[] = [];
  const critical = isCritical(task, policy);
  const security = isSecuritySensitive(task);
  // Économie = seuils plus hauts avant d'appeler Opus ; qualité = plus bas. Jamais pour les planchers critiques.
  const shift = policy.budget === 'economy' ? 1 : policy.budget === 'quality' ? -1 : 0;
  const threshold = (base: number) => clampLevel(base + shift);

  if (critical) reasons.push(`Domaine critique (${task.domains.filter((d) => policy.criticalDomains.includes(d)).join(', ') || `risque ${a.risk}`}) : planchers de qualité appliqués, l'économie ne s'applique pas.`);

  // ---- Escalade et blocage
  const failures = failedAttempts(task);
  const escalateNow = failures >= policy.maxAttemptsBeforeEscalation && !opusFailed(task);
  const blockForHuman = opusFailed(task) && failures >= policy.maxAttemptsBeforeEscalation + 1;
  if (escalateNow) reasons.push(`${failures} tentative(s) échouée(s) ≥ seuil ${policy.maxAttemptsBeforeEscalation} : ESCALATE_TO_OPUS sur le problème précis.`);
  if (blockForHuman) reasons.push('Opus a déjà échoué sur cette tâche : blocage et demande d\'intervention humaine.');

  // ---- Besoin de raisonnement de niveau Opus pour la conception
  const designTriggers: string[] = [];
  if (a.ambiguity >= threshold(4)) designTriggers.push(`ambiguïté ${a.ambiguity}`);
  if (a.architecturalImpact >= threshold(4)) designTriggers.push(`impact architectural ${a.architecturalImpact}`);
  if (a.novelty >= threshold(4) && a.complexity >= threshold(3)) designTriggers.push(`nouveauté ${a.novelty} + complexité ${a.complexity}`);
  if (critical && a.complexity >= 3) designTriggers.push('domaine critique non trivial');
  if (ctx.overrides?.opusDesignKinds?.includes(task.kind) && a.complexity >= 3) designTriggers.push(`adaptation : les tâches « ${task.kind} » escaladent souvent`);
  const needsOpusDesign = designTriggers.length > 0 && task.kind !== 'chore' && task.kind !== 'docs';
  if (needsOpusDesign) reasons.push(`Conception confiée à Opus (${designTriggers.join(', ')}) ; l'implémentation reste chez un worker.`);

  // ---- Implémenteur
  const implementer = chooseImplementer(task, ctx, { critical, escalateNow, reasons });

  // ---- Exécuteur : direct quand déléguer coûte plus que faire
  const executor = chooseExecutor(task, ctx, implementer.model, needsOpusDesign, reasons);

  // ---- Revue
  const reviewLevel = chooseReview(task, ctx, critical, security, reasons);

  // ---- Stratégie de test
  const testStrategy = chooseTestStrategy(task, policy, critical);
  reasons.push(`Tests : ${testStrategy.flow}${testStrategy.testFirst ? ' (test-first)' : ''}.`);

  // ---- Phases (UNDERSTAND → … → DONE, proportionnées)
  const phases = buildPhases(task, ctx, { critical, security, needsOpusDesign, implementer, reviewLevel, testStrategy, executor });

  const gates = selectGates(task, reviewLevel, policy, executor === 'subagent');
  const checkpointBefore = a.risk >= 3 || ['refactor', 'migration', 'infra'].includes(task.kind) || a.contextSize === 'L';
  if (checkpointBefore) reasons.push('Checkpoint avant modification (risque ≥ 3, refactor/migration/infra ou gros contexte).');

  const humanApproval = needsHuman(task, policy, critical, blockForHuman);
  if (humanApproval.required) reasons.push(`Approbation humaine : ${humanApproval.reason}`);

  const costIndex = round1(
    phases.reduce((sum, p) => sum + MODEL_WEIGHT[p.model] * EFFORT_WEIGHT[p.effort] * (CONTEXT_WEIGHT[a.contextSize] + (p.agent === 'orchestrator' ? 0 : SPAWN_OVERHEAD)), 0),
  );

  return {
    executor,
    implementer,
    phases,
    reviewLevel,
    testStrategy,
    gates,
    checkpointBefore,
    maxAttempts: policy.maxAttemptsBeforeEscalation,
    escalate: escalateNow
      ? { required: true, to: 'ceng-principal', reason: `${failures} échec(s) au niveau ${lastModel(task)}` }
      : blockForHuman
        ? { required: true, to: 'human', reason: 'Échec après escalade Opus' }
        : { required: false },
    humanApproval,
    costIndex,
    reasons,
    decidedAt: ctx.now ?? new Date().toISOString(),
  };
}

function lastModel(task: Task): ModelTier {
  return task.attempts.at(-1)?.model ?? 'sonnet';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

interface ImplementerFlags {
  critical: boolean;
  escalateNow: boolean;
  reasons: string[];
}

function chooseImplementer(task: Task, ctx: RoutingContext, f: ImplementerFlags): RouteDecision['implementer'] {
  const a = task.assessment;
  const { policy } = ctx;
  const effort = chooseEffort(task, policy, f.critical);

  if (f.escalateNow) {
    f.reasons.push('Implémentation reprise par Opus après échecs répétés.');
    return { agent: 'ceng-engineer', model: 'opus', effort: shiftEffort(effort, 1) };
  }
  if (task.kind === 'research') return { agent: 'ceng-researcher', model: a.ambiguity >= 4 ? 'opus' : 'sonnet', effort };
  if (task.kind === 'design') return { agent: 'ceng-creative-director', model: 'opus', effort: 'high' };
  if (task.kind === 'ui' && ctx.hasCreativeDirection) {
    f.reasons.push('UI avec direction créative existante : exécutant frontend, sans réinvention du design.');
    return { agent: 'ceng-frontend-executor', model: 'sonnet', effort };
  }
  if (task.kind === 'test') return { agent: 'ceng-tester', model: 'sonnet', effort };

  const mechanical = a.complexity <= 1 && a.risk <= 1 && a.ambiguity <= 2 && !f.critical;
  if (mechanical && ['chore', 'docs'].includes(task.kind) && !ctx.overrides?.disableHaikuImplementation && policy.budget !== 'quality') {
    f.reasons.push('Tâche mécanique à faible risque : Haiku suffit.');
    return { agent: 'ceng-builder', model: 'haiku', effort: 'low' };
  }
  if (a.complexity >= 5 && f.critical) {
    f.reasons.push('Complexité maximale en domaine critique : implémentation par Opus.');
    return { agent: 'ceng-engineer', model: 'opus', effort };
  }
  if (a.complexity >= 4 || a.risk >= 4 || (task.kind === 'bug' && a.complexity >= 3)) {
    f.reasons.push('Tâche définie mais exigeante : Sonnet avec effort élevé (ceng-engineer).');
    return { agent: 'ceng-engineer', model: 'sonnet', effort };
  }
  return { agent: 'ceng-builder', model: 'sonnet', effort };
}

export function chooseEffort(task: Task, policy: EffectivePolicy, critical: boolean): Effort {
  const a = task.assessment;
  const score = Math.max(a.complexity, a.ambiguity, Math.min(a.novelty, a.complexity + 1)) as Level;
  let effort: Effort = score <= 1 ? 'low' : score <= 3 ? 'medium' : score === 4 ? 'high' : 'xhigh';
  if (policy.budget === 'economy' && !critical) effort = shiftEffort(effort, -1);
  if (policy.budget === 'quality') effort = shiftEffort(effort, 1);
  if (critical && EFFORTS.indexOf(effort) < EFFORTS.indexOf('high')) effort = 'high';
  return effort;
}

function chooseExecutor(task: Task, ctx: RoutingContext, model: ModelTier, needsOpusDesign: boolean, reasons: string[]): RouteDecision['executor'] {
  const a = task.assessment;
  const orch = ctx.policy.orchestratorModel;
  if (a.contextSize === 'L') {
    reasons.push('Gros volume de contexte : délégation pour isoler le contexte principal.');
    return 'subagent';
  }
  if (isTrivial(task) && !needsOpusDesign) {
    reasons.push('Tâche triviale : exécution directe (le coût de délégation dépasse le travail).');
    return 'direct';
  }
  if (orch === model && a.complexity <= 2 && a.risk <= 2 && !needsOpusDesign && orch !== 'opus') {
    reasons.push('Même modèle que l\'orchestrateur et tâche courte : exécution directe.');
    return 'direct';
  }
  reasons.push(orch === 'opus' ? 'Orchestrateur Opus : le code est produit par un worker.' : 'Délégation pour garder le contexte principal compact.');
  return 'subagent';
}

function chooseReview(task: Task, ctx: RoutingContext, critical: boolean, security: boolean, reasons: string[]): ReviewLevel {
  const a = task.assessment;
  const { policy } = ctx;
  let level: ReviewLevel;
  if (critical) level = 'critical';
  else if (a.risk >= 3 || a.complexity >= 4 || a.architecturalImpact >= 3) level = 'thorough';
  else if (a.risk <= 1 && a.complexity <= 2) level = 'none';
  else level = 'targeted';

  if (task.kind === 'research' || task.kind === 'docs' || task.kind === 'design') level = 'none';
  if (!critical && policy.reviewPolicy === 'minimal') level = shiftReview(level, -1);
  if (policy.reviewPolicy === 'always' && level === 'none' && !['research', 'design'].includes(task.kind)) level = 'targeted';
  const bump = ctx.overrides?.reviewBump?.[task.kind] ?? 0;
  if (bump > 0 && level !== 'critical') {
    level = shiftReview(level, bump);
    reasons.push(`Revue relevée par adaptation (les tâches « ${task.kind} » ont souvent échoué aux gates).`);
  }
  if (security && level === 'none' && task.kind !== 'research') level = 'targeted';
  reasons.push(`Revue : ${level}.`);
  return level;
}

export function chooseTestStrategy(task: Task, policy: EffectivePolicy, critical: boolean): TestStrategy {
  const property = task.domains.some((d) => ['payments', 'finance', 'serialization', 'parsing', 'concurrency'].includes(d));
  const depth = policy.testingDepth;
  switch (task.kind) {
    case 'bug':
      return { flow: 'reproduction → test de régression (rouge) → correction → validation', testFirst: true, types: ['regression', ...(critical ? ['integration'] : [])] };
    case 'ui':
      return {
        flow: 'prototype → implémentation → validation visuelle → tests adaptés',
        testFirst: false,
        types: ['component', 'accessibility', ...(critical || depth === 'thorough' ? ['e2e'] : []), ...(depth === 'thorough' ? ['visual'] : [])],
      };
    case 'refactor':
      return { flow: 'tests de caractérisation verts avant → refactor → mêmes tests verts après', testFirst: true, types: ['characterization', 'unit'] };
    case 'migration':
      return { flow: 'migration up/down sur base éphémère → validation des données → tests d\'intégration', testFirst: true, types: ['migration', 'integration'] };
    case 'research':
    case 'design':
    case 'docs':
      return { flow: 'pas de tests (livrable documentaire)', testFirst: false, types: [] };
    case 'security':
      return { flow: 'cas d\'abus → tests de sécurité (rouges) → correctif → validation', testFirst: true, types: ['security', 'regression', 'integration'] };
    case 'chore':
      return { flow: 'suite existante verte', testFirst: false, types: ['existing'] };
    default:
      if (critical) {
        return {
          flow: 'spécification → stratégie de test → implémentation → validation',
          testFirst: true,
          types: ['unit', 'integration', ...(property || depth !== 'light' ? ['property'] : []), ...(depth !== 'light' ? ['e2e'] : [])],
        };
      }
      return {
        flow: task.assessment.complexity >= 3 ? 'stratégie de test → implémentation → tests → validation' : 'implémentation + tests ciblés',
        testFirst: task.assessment.complexity >= 4 && task.assessment.ambiguity <= 2,
        types: ['unit', ...(task.assessment.risk >= 3 ? ['integration'] : []), ...(property ? ['property'] : [])],
      };
  }
}

interface PhaseFlags {
  critical: boolean;
  security: boolean;
  needsOpusDesign: boolean;
  implementer: RouteDecision['implementer'];
  reviewLevel: ReviewLevel;
  testStrategy: TestStrategy;
  executor: RouteDecision['executor'];
}

function buildPhases(task: Task, ctx: RoutingContext, f: PhaseFlags): Phase[] {
  const a = task.assessment;
  const phases: Phase[] = [];
  const orch = ctx.policy.orchestratorModel;
  const push = (p: Phase) => phases.push(p);

  if (a.contextSize !== 'S' && f.executor === 'subagent' && task.kind !== 'research') {
    push({ step: 'understand', agent: 'ceng-scout', model: 'haiku', effort: 'low', why: 'Cartographier le code concerné sans charger le contexte principal.' });
  }
  if (a.novelty >= 4 && ctx.policy.researchPolicy !== 'minimal' && task.kind !== 'research') {
    push({ step: 'research', agent: 'ceng-researcher', model: 'sonnet', effort: 'medium', why: 'Technologie/API nouvelle : vérifier la documentation officielle avant de décider.' });
  }
  if (f.critical && f.security) {
    push({ step: 'threat-model', agent: 'ceng-security', model: 'opus', effort: 'high', why: 'Domaine critique et sensible : analyse de menaces avant implémentation.' });
  } else if (f.security && a.risk >= 4) {
    push({ step: 'threat-model', agent: 'ceng-security', model: 'sonnet', effort: 'high', why: 'Risque élevé sur surface sensible : check-list de menaces.' });
  }
  if (f.needsOpusDesign) {
    push({ step: 'design', agent: 'ceng-principal', model: 'opus', effort: a.ambiguity >= 5 || a.architecturalImpact >= 5 ? 'xhigh' : 'high', why: 'Décision de conception/architecture puis implémentation par le même agent (ADR si structurant).' });
  }
  if (f.testStrategy.testFirst) {
    push({ step: 'test-design', agent: f.executor === 'direct' ? 'orchestrator' : f.implementer.agent, model: f.executor === 'direct' ? orch : f.implementer.model, effort: f.implementer.effort, why: f.testStrategy.flow });
  }
  if (f.executor === 'direct') {
    push({ step: 'implement', agent: 'orchestrator', model: orch, effort: f.implementer.effort, why: 'Exécution directe.' });
  } else {
    push({ step: 'implement', agent: f.implementer.agent, model: f.implementer.model, effort: f.implementer.effort, why: 'Worker d\'exécution.' });
  }
  if (f.testStrategy.types.length > 0) {
    push({ step: 'test', agent: f.executor === 'direct' ? 'orchestrator' : f.implementer.agent, model: f.executor === 'direct' ? orch : f.implementer.model, effort: 'low', why: `Exécuter : ${f.testStrategy.types.join(', ')}.` });
  }
  if (f.reviewLevel !== 'none') {
    const reviewModel: ModelTier = f.reviewLevel === 'critical' ? 'opus' : 'sonnet';
    push({ step: 'review', agent: 'ceng-reviewer', model: reviewModel, effort: f.reviewLevel === 'targeted' ? 'medium' : 'high', why: `Revue ${f.reviewLevel}.` });
    push({ step: 'refine', agent: f.executor === 'direct' ? 'orchestrator' : f.implementer.agent, model: f.executor === 'direct' ? orch : f.implementer.model, effort: 'medium', why: 'Corriger les constats bloquants de la revue, puis re-tester.' });
  }
  if (f.security && f.reviewLevel !== 'none') {
    push({ step: 'security-review', agent: 'ceng-security', model: f.critical ? 'opus' : 'sonnet', effort: 'high', why: 'Validation sécurité (injection, authz, secrets, données).' });
  }
  if (f.reviewLevel === 'critical' && a.architecturalImpact >= 3) {
    push({ step: 'architecture-review', agent: 'ceng-principal', model: 'opus', effort: 'high', why: 'Intégration architecturale en domaine critique.' });
  }
  push({ step: 'gates', agent: 'orchestrator', model: orch, effort: 'low', why: 'Quality gates sélectionnées selon le risque.' });
  return phases;
}

function needsHuman(task: Task, policy: EffectivePolicy, critical: boolean, blocked: boolean): RouteDecision['humanApproval'] {
  if (blocked) return { required: true, reason: 'échec persistant après escalade.' };
  if (['infra', 'migration'].includes(task.kind) && critical) return { required: true, reason: 'changement d\'infrastructure ou de données en domaine critique.' };
  if (critical && policy.autonomy !== 'high' && task.assessment.risk >= 5) return { required: true, reason: 'risque maximal en domaine critique (autonomie non « high »).' };
  if (task.domains.includes('licensing')) return { required: true, reason: 'décision de licence / conformité légale.' };
  if (policy.autonomy === 'supervised' && task.assessment.risk >= 4) return { required: true, reason: 'autonomie supervisée et risque ≥ 4.' };
  return { required: false };
}
