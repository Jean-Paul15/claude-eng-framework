/**
 * Types du domaine. Aucune dépendance d'infrastructure ici : ce module est importé
 * par la politique de routage, le planner, les gates et l'adaptation, tous purs.
 */

export type Level = 1 | 2 | 3 | 4 | 5;
export type ContextSize = 'S' | 'M' | 'L';
export type ModelTier = 'haiku' | 'sonnet' | 'opus';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh';

export const TASK_KINDS = [
  'feature', 'bug', 'refactor', 'research', 'chore', 'ui', 'design', 'docs',
  'test', 'infra', 'migration', 'security',
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_STATUSES = ['pending', 'in_progress', 'blocked', 'failed', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Évaluation d'une tâche, renseignée par l'orchestrateur (jugement) puis exploitée par le routeur (politique). */
export interface Assessment {
  complexity: Level;
  risk: Level;
  ambiguity: Level;
  novelty: Level;
  architecturalImpact: Level;
  contextSize: ContextSize;
}

export type AttemptOutcome = 'running' | 'success' | 'failure' | 'escalated' | 'abandoned';

export interface Attempt {
  n: number;
  agent: string;
  model: ModelTier;
  strategy?: string;
  startedAt: string;
  endedAt?: string;
  outcome: AttemptOutcome;
  reason?: string;
}

export type GateStatus = 'pass' | 'fail' | 'skipped' | 'pending' | 'waived';

export interface GateResult {
  gate: GateId;
  status: GateStatus;
  required: boolean;
  at: string;
  detail?: string;
}

export interface Task {
  id: string;
  title: string;
  kind: TaskKind;
  status: TaskStatus;
  assessment: Assessment;
  /** Globs des fichiers que la tâche a le droit de modifier (propriété de fichiers pour le parallélisme). */
  files: string[];
  deps: string[];
  acceptance: string[];
  /** Domaines métier/techniques touchés (payments, auth, pii, database…) : relèvent la profondeur de validation. */
  domains: string[];
  /** Contrats partagés (ex. "api:/orders") : deux tâches qui partagent un contrat ont besoin de coordination. */
  interfaces: string[];
  group?: string;
  route?: RouteDecision;
  attempts: Attempt[];
  gates: GateResult[];
  blockedReason?: string;
  evidence?: string;
  waiver?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------- Politique

export type Budget = 'economy' | 'balanced' | 'quality';
export type Autonomy = 'supervised' | 'balanced' | 'high';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type Depth3 = 'light' | 'standard' | 'thorough';
export type Parallelism = 'off' | 'subagents' | 'teams';
export type ReviewPolicy = 'minimal' | 'adaptive' | 'always';
export type ResearchPolicy = 'minimal' | 'when-needed' | 'proactive';
export type ModelStrategy = 'adaptive' | 'opus-orchestrator' | 'sonnet-orchestrator';
export type DeploymentPermission = 'none' | 'staging' | 'production-with-approval';

/** Préférences déclarées à l'init : ce sont des intentions, pas des contraintes absolues. */
export interface Preferences {
  projectType: string;
  riskLevel: RiskLevel;
  autonomy: Autonomy;
  budget: Budget;
  quality: Depth3;
  testingDepth: Depth3;
  securityDepth: Depth3;
  parallelism: Parallelism;
  maxParallel: number;
  modelStrategy: ModelStrategy;
  deployment: DeploymentPermission;
  researchPolicy: ResearchPolicy;
  reviewPolicy: ReviewPolicy;
}

/** Politique effective après réconciliation préférences ↔ réalité du projet. */
export interface EffectivePolicy extends Preferences {
  /** Domaines où l'économie de tokens ne s'applique pas (planchers de qualité). */
  criticalDomains: string[];
  orchestratorModel: ModelTier;
  maxAttemptsBeforeEscalation: number;
  notes: string[];
}

/** Ajustements appris (cf. adaptation) — toujours bornés et expliqués. */
export interface AdaptiveOverrides {
  maxParallel?: number;
  /** Kinds pour lesquels une phase de conception Opus est ajoutée plus tôt. */
  opusDesignKinds?: TaskKind[];
  /** Relèvement du niveau de revue par kind. */
  reviewBump?: Partial<Record<TaskKind, number>>;
  /** Désactive l'implémentation par Haiku si elle échoue trop souvent. */
  disableHaikuImplementation?: boolean;
  reasons: string[];
  updatedAt: string;
}

// ---------------------------------------------------------------- Routage

export type Executor = 'direct' | 'subagent';
export type ReviewLevel = 'none' | 'targeted' | 'thorough' | 'critical';
export type PhaseStep =
  | 'understand' | 'research' | 'threat-model' | 'design' | 'test-design' | 'implement'
  | 'test' | 'review' | 'security-review' | 'architecture-review' | 'refine' | 'gates' | 'human-approval';

export interface Phase {
  step: PhaseStep;
  agent: string;
  model: ModelTier;
  effort: Effort;
  why: string;
}

export interface TestStrategy {
  flow: string;
  testFirst: boolean;
  types: string[];
}

export interface RouteDecision {
  executor: Executor;
  implementer: { agent: string; model: ModelTier; effort: Effort };
  phases: Phase[];
  reviewLevel: ReviewLevel;
  testStrategy: TestStrategy;
  gates: GateRequirement[];
  checkpointBefore: boolean;
  maxAttempts: number;
  escalate: { required: boolean; to?: string; reason?: string };
  humanApproval: { required: boolean; reason?: string };
  costIndex: number;
  reasons: string[];
  decidedAt: string;
}

// ---------------------------------------------------------------- Gates

export const GATE_IDS = [
  'build', 'typecheck', 'lint', 'format', 'unit', 'integration', 'e2e', 'contract',
  'deps-audit', 'secrets', 'compliance', 'migration', 'performance', 'accessibility',
  'visual', 'ux', 'docs', 'review', 'security-review', 'architecture-review', 'report', 'human-approval',
] as const;
export type GateId = (typeof GATE_IDS)[number];

export type GateKind = 'command' | 'builtin' | 'agent' | 'human';

export interface GateRequirement {
  gate: GateId;
  required: boolean;
  why: string;
}

// ---------------------------------------------------------------- Planification

export type ExecutionMode = 'direct' | 'sequential' | 'parallel-subagents' | 'agent-team';

export interface PlannedBatch {
  mode: ExecutionMode;
  tasks: string[];
  isolation: 'none' | 'worktree';
  reasons: string[];
}

export interface ExecutionPlan {
  batches: PlannedBatch[];
  deferred: { task: string; reason: string }[];
  reasons: string[];
}
