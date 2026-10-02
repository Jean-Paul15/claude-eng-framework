import { LEGAL_SENSITIVE_DOMAINS, SECURITY_SENSITIVE_DOMAINS } from './policy.js';
import type { EffectivePolicy, GateId, GateKind, GateRequirement, ReviewLevel, Task } from './types.js';

export const GATE_KINDS: Record<GateId, GateKind> = {
  build: 'command',
  typecheck: 'command',
  lint: 'command',
  format: 'command',
  unit: 'command',
  integration: 'command',
  e2e: 'command',
  contract: 'command',
  'deps-audit': 'command',
  performance: 'command',
  migration: 'command',
  accessibility: 'agent',
  secrets: 'builtin',
  compliance: 'builtin',
  report: 'builtin',
  visual: 'agent',
  ux: 'agent',
  docs: 'agent',
  review: 'agent',
  'security-review': 'agent',
  'architecture-review': 'agent',
  'human-approval': 'human',
};

const CODE_KINDS = new Set(['feature', 'bug', 'refactor', 'ui', 'test', 'infra', 'migration', 'security', 'chore']);

const intersects = (a: readonly string[], b: readonly string[]) => a.some((x) => b.includes(x));

/**
 * Sélectionne les quality gates proportionnées au risque de la tâche.
 * Une gate « required » bloque `task done` ; une gate optionnelle est exécutée si disponible.
 */
export function selectGates(task: Task, review: ReviewLevel, policy: EffectivePolicy, delegated: boolean): GateRequirement[] {
  const gates: GateRequirement[] = [];
  const add = (gate: GateId, required: boolean, why: string) => {
    const existing = gates.find((g) => g.gate === gate);
    if (existing) {
      existing.required ||= required;
      return;
    }
    gates.push({ gate, required, why });
  };
  const a = task.assessment;
  const critical = intersects(task.domains, policy.criticalDomains) || a.risk >= 5;
  const securitySensitive = intersects(task.domains, SECURITY_SENSITIVE_DOMAINS) || task.kind === 'security';
  const changesCode = CODE_KINDS.has(task.kind);

  if (task.kind === 'docs') add('docs', true, 'Tâche de documentation : relecture de cohérence.');
  if (task.kind === 'research' || task.kind === 'design') {
    add('report', true, 'Le livrable d\'une recherche/conception est un document écrit.');
    return gates;
  }

  if (changesCode) {
    add('build', true, 'Tout changement de code doit compiler/construire.');
    add('typecheck', true, 'Les erreurs de types sont des défauts bon marché à détecter.');
    add('lint', a.risk >= 2 || policy.quality !== 'light', 'Conventions et défauts statiques du projet.');
    add('unit', true, 'Les tests existants et nouveaux doivent passer.');
    add('secrets', true, 'Aucun secret ne doit entrer dans le dépôt (scanner intégré, coût quasi nul).');
  }
  if (changesCode && (a.risk >= 3 || a.complexity >= 3 || critical || task.kind === 'migration')) {
    add('integration', critical || a.risk >= 4, 'Frontières I/O touchées ou risque ≥ 3.');
  }
  if (task.kind === 'migration' || task.domains.includes('database-migration')) {
    add('migration', true, 'Migration : application + retour arrière sur base éphémère.');
  }
  if (task.domains.includes('api') && (task.interfaces.length > 0 || a.architecturalImpact >= 3)) {
    add('contract', a.risk >= 3, 'Contrat d\'API partagé modifié.');
  }
  if (critical && changesCode) {
    add('e2e', policy.testingDepth !== 'light', 'Parcours critique : validation de bout en bout.');
  }
  if (securitySensitive || critical || policy.securityDepth === 'thorough') {
    add('deps-audit', critical, 'Domaine sensible : audit des dépendances.');
  }
  if (intersects(task.domains, LEGAL_SENSITIVE_DOMAINS) || task.domains.includes('dependencies')) {
    add('compliance', critical || task.domains.includes('licensing'), 'Implications légales (licences, données personnelles, conformité).');
  }
  if (task.kind === 'ui' || task.domains.includes('frontend')) {
    add('accessibility', policy.quality !== 'light', 'Toute UI doit rester accessible (WCAG 2.2 AA).');
    add('ux', task.assessment.risk >= 3, 'Cohérence UX (feedback, erreurs, états vides/chargement).');
    if (policy.quality === 'thorough' || task.domains.includes('design-system')) add('visual', false, 'Cohérence visuelle avec le design system.');
  }
  if (task.domains.includes('performance') || (a.risk >= 4 && task.domains.includes('hot-path'))) {
    add('performance', a.risk >= 4, 'Chemin chaud : mesurer avant/après.');
  }
  if (task.kind === 'feature' && a.architecturalImpact >= 3) add('docs', false, 'Impact architectural : documentation/ADR à jour.');

  switch (review) {
    case 'none':
      break;
    case 'targeted':
      add('review', true, 'Revue ciblée sur le diff.');
      break;
    case 'thorough':
      add('review', true, 'Revue approfondie (risque ou complexité élevés).');
      break;
    case 'critical':
      add('review', true, 'Revue complète du diff.');
      add('security-review', true, 'Domaine critique : revue sécurité dédiée.');
      if (a.architecturalImpact >= 3) add('architecture-review', true, 'Impact architectural en domaine critique.');
      break;
  }
  if (securitySensitive && review !== 'none') add('security-review', true, 'Domaine sensible à la sécurité.');
  if (delegated) add('report', true, 'Une tâche déléguée doit laisser un rapport exploitable.');
  return gates;
}
