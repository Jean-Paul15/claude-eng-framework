import type { EffectivePolicy, ModelTier, Preferences, RiskLevel } from './types.js';

/** Domaines où une erreur coûte de l'argent, des données ou la sécurité : planchers de qualité non négociables. */
export const ALWAYS_CRITICAL_DOMAINS = ['payments', 'finance', 'health', 'secrets'] as const;

/** Domaines qui déclenchent systématiquement une revue sécurité, quelle que soit la préférence budget. */
export const SECURITY_SENSITIVE_DOMAINS = [
  'auth', 'authorization', 'payments', 'finance', 'health', 'pii', 'secrets', 'crypto',
  'upload', 'webhooks', 'multi-tenant', 'infra', 'command-execution', 'ai-llm',
] as const;

/** Domaines à implications légales/gouvernance : déclenchent la gate `compliance`. */
export const LEGAL_SENSITIVE_DOMAINS = ['pii', 'health', 'payments', 'finance', 'ai-llm', 'licensing', 'analytics'] as const;

export const DEFAULT_PREFERENCES: Preferences = {
  projectType: 'auto',
  riskLevel: 'medium',
  autonomy: 'balanced',
  budget: 'balanced',
  quality: 'standard',
  testingDepth: 'standard',
  securityDepth: 'standard',
  parallelism: 'subagents',
  maxParallel: 3,
  modelStrategy: 'adaptive',
  deployment: 'none',
  researchPolicy: 'when-needed',
  reviewPolicy: 'adaptive',
};

const RISK_ORDER: RiskLevel[] = ['low', 'medium', 'high', 'critical'];

export function riskRank(r: RiskLevel): number {
  return RISK_ORDER.indexOf(r);
}

export interface ProjectSignals {
  detectedRisk: RiskLevel;
  domains: string[];
  interactiveTeamsPossible: boolean;
}

/**
 * Réconcilie les préférences de l'utilisateur avec ce que la découverte a trouvé.
 * Les préférences sont conservées pour le travail ordinaire ; seuls les domaines critiques
 * reçoivent des planchers, et chaque écart est expliqué dans `notes`.
 */
export function reconcile(prefs: Preferences, signals: ProjectSignals): EffectivePolicy {
  const notes: string[] = [];
  const effective: Preferences = { ...prefs };

  if (riskRank(signals.detectedRisk) > riskRank(prefs.riskLevel)) {
    notes.push(
      `Risque déclaré « ${prefs.riskLevel} » mais signaux détectés de niveau « ${signals.detectedRisk} » ` +
        `(${signals.domains.join(', ') || 'n/a'}) : le niveau « ${signals.detectedRisk} » est retenu pour le calcul des planchers.`,
    );
    effective.riskLevel = signals.detectedRisk;
  }

  const criticalDomains = new Set<string>(
    signals.domains.filter((d) => (ALWAYS_CRITICAL_DOMAINS as readonly string[]).includes(d)),
  );
  if (riskRank(effective.riskLevel) >= riskRank('high')) {
    for (const d of signals.domains) {
      if ((SECURITY_SENSITIVE_DOMAINS as readonly string[]).includes(d)) criticalDomains.add(d);
    }
  }

  if (prefs.budget === 'economy' && criticalDomains.size > 0) {
    notes.push(
      `La stratégie économique est conservée pour les tâches ordinaires, mais les opérations touchant ` +
        `${[...criticalDomains].join(', ')} reçoivent une profondeur de raisonnement, de test et de revue supérieure.`,
    );
  }
  if (prefs.securityDepth === 'light' && criticalDomains.size > 0) {
    effective.securityDepth = 'standard';
    notes.push('Profondeur sécurité « light » relevée à « standard » : le projet contient des domaines critiques.');
  }
  if (prefs.testingDepth === 'light' && criticalDomains.size > 0) {
    notes.push('Tests « light » conservés hors domaines critiques ; les domaines critiques exigent tests d\'intégration et de propriétés.');
  }
  if (prefs.parallelism === 'teams' && !signals.interactiveTeamsPossible) {
    notes.push('Agent Teams demandées mais indisponibles dans ce contexte (non interactif) : repli sur des subagents parallèles.');
    effective.parallelism = 'subagents';
  }
  if (prefs.autonomy === 'high' && effective.riskLevel === 'critical') {
    notes.push(
      'Autonomie « high » conservée pour le code, mais les actions irréversibles (déploiement, données, infra, secrets, ' +
        'licences) restent soumises à approbation humaine — non négociable.',
    );
  }

  const orchestratorModel = chooseOrchestratorModel(effective, criticalDomains.size);
  if (effective.modelStrategy === 'adaptive') {
    notes.push(
      orchestratorModel === 'opus'
        ? 'Orchestrateur recommandé : Opus (risque/ambiguïté du projet) ; il délègue l\'implémentation aux workers Sonnet.'
        : 'Orchestrateur recommandé : Sonnet (projet au risque modéré) ; escalade ponctuelle vers Opus quand une décision le justifie.',
    );
  }

  return {
    ...effective,
    criticalDomains: [...criticalDomains].sort(),
    orchestratorModel,
    maxAttemptsBeforeEscalation: effective.budget === 'quality' ? 1 : 2,
    notes,
  };
}

function chooseOrchestratorModel(p: Preferences, criticalCount: number): ModelTier {
  if (p.modelStrategy === 'opus-orchestrator') return 'opus';
  if (p.modelStrategy === 'sonnet-orchestrator') return 'sonnet';
  if (p.budget === 'quality') return 'opus';
  if (p.budget === 'economy') return p.riskLevel === 'critical' ? 'opus' : 'sonnet';
  if (riskRank(p.riskLevel) >= riskRank('high') || criticalCount > 0) return 'opus';
  return 'sonnet';
}
