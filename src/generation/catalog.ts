import type { ProjectProfile } from '../discovery/profile.js';

/**
 * Catalogue des skills et agents du cœur, avec la règle qui décide de leur installation.
 * Chaque skill installée coûte du contexte permanent (sa description) : on n'installe que
 * ce que le projet justifie. Ajouter une skill au cœur = un dossier dans core/skills + une entrée ici.
 */

export interface AssetSpec {
  name: string;
  when: (p: ProjectProfile) => boolean;
  why: string;
}

const always = () => true;
const hasDb = (p: ProjectProfile) => p.databases.length > 0 || p.orm.length > 0 || p.migrations.length > 0;
const isServer = (p: ProjectProfile) => p.projectTypes.some((t) => ['api', 'web-app', 'data'].includes(t)) && (p.projectTypes.includes('api') || p.frameworks.some((f) => ['next', 'nuxt', 'django', 'rails', '@sveltejs/kit', '@remix-run/react'].includes(f)));
const isRunningService = (p: ProjectProfile) => isServer(p) || p.deployment.length > 0 || p.infra.length > 0;
const securityHeavy = (p: ProjectProfile) => p.riskLevel === 'high' || p.riskLevel === 'critical' || p.domains.some((d) => ['auth', 'payments', 'pii', 'upload', 'webhooks', 'multi-tenant', 'ai-llm'].includes(d.name));

export const SKILLS: AssetSpec[] = [
  { name: 'ceng-orchestrate', when: always, why: 'Protocole de l\'orchestrateur (cœur du framework).' },
  { name: 'ceng-skill-forge', when: always, why: 'Création et amélioration contrôlée des skills.' },
  { name: 'ceng-relay', when: always, why: "Coordination entre sessions parallèles : relais d'événements, passage sur un modèle plus fort au bon moment, équipe autonome." },
  { name: 'ceng-setup', when: always, why: 'Installation, mise à jour et diagnostic du framework — voyage avec le dépôt (nouvelle machine, clone).' },
  { name: 'ceng-delivery', when: always, why: 'Du cahier des charges à la livraison : cadrage court, agile accéléré, artefacts exécutables, décisions production.' },
  // Toujours installées (skills ET agents créatifs) : un projet qui part d'un cahier des charges n'a pas encore d'UI détectable, le routage envoie pourtant ses tâches `design` vers ceng-creative-director ; une skill non utilisée ne coûte que sa description.
  { name: 'ceng-spec-intake', when: always, why: 'Lecture d\'un cahier des charges (PDF, images) dans un contexte séparé : exigences numérotées, maquettes.' },
  { name: 'ux-principles', when: always, why: "Révélation progressive, budget d'écran, élévation sobre, typographie choisie, responsive mobile/tablette." },
  { name: 'visual-flow-testing', when: always, why: 'Test principal des interfaces : parcours capturés en images, relus et corrigés.' },
  { name: 'scale-algorithms', when: (p) => isServer(p) || hasDb(p) || p.projectTypes.includes('data') || p.projectTypes.includes('mobile') || p.projectTypes.includes('api'), why: 'Algorithmes qui tiennent le volume (proximité, matching, classement) et leur coût.' },
  { name: 'ios-release', when: always, why: 'App mobile : pré-contrôles, build iOS sans Mac, TestFlight, App Store Connect, motifs de rejet.' },
  { name: 'supabase-workflow', when: always, why: 'Supabase : local sous Docker, production par migrations ou directe selon la consigne, CLI ou MCP.' },
  { name: 'dependencies', when: always, why: 'Choisir et vérifier une dépendance (licence, maintenance, vulnérabilités) avant de l\'ajouter.' },
  { name: 'compliance-by-design', when: always, why: 'Socle obligatoire des produits avec comptes ou données personnelles (politiques, consentements, conservation, audit, anomalies, incidents).' },
  { name: 'software-engineering', when: always, why: 'Critères de qualité et leurs contre-indications.' },
  { name: 'architecture', when: always, why: 'Jugement architectural proportionné.' },
  { name: 'testing', when: always, why: 'Choix de la stratégie de test.' },
  { name: 'tdd', when: always, why: 'Procédure test-first quand elle est rentable.' },
  { name: 'debugging', when: always, why: 'Recherche de cause racine.' },
  { name: 'code-reviewing', when: always, why: 'Revue proportionnée au risque.' },
  { name: 'security', when: always, why: 'Sécurité dès la conception.' },
  { name: 'legal-governance', when: always, why: 'Licences, données personnelles, gouvernance — jamais oubliées.' },
  { name: 'git', when: always, why: 'Traçabilité, commits, checkpoints.' },
  { name: 'documentation', when: always, why: 'Documentation utile et à jour.' },
  { name: 'research', when: always, why: 'Recherche de sources fiables avant décision.' },
  { name: 'threat-modeling', when: (p) => securityHeavy(p) || p.projectTypes.includes('api'), why: 'Surface d\'attaque significative.' },
  { name: 'database', when: hasDb, why: 'Base de données détectée (transactions, migrations, index).' },
  { name: 'api-design', when: (p) => p.projectTypes.includes('api') || isServer(p), why: 'API exposée.' },
  { name: 'backend', when: isServer, why: 'Code serveur détecté.' },
  { name: 'frontend', when: always, why: 'Interface utilisateur (projet à venir compris).' },
  { name: 'accessibility', when: always, why: 'Toute UI doit être accessible.' },
  { name: 'performance', when: (p) => p.ui || isServer(p) || p.projectTypes.includes('data') || p.projectTypes.includes('mobile'), why: 'Chemins chauds probables (UI, serveur, data).' },
  { name: 'observability', when: isRunningService, why: 'Service déployé ou serveur : logs, métriques, traces.' },
  { name: 'ci-cd', when: (p) => p.ci.providers.length > 0 || p.deployment.length > 0, why: 'CI ou déploiement détecté.' },
  { name: 'creative-director', when: always, why: 'Direction créative et motion (le routage y envoie les tâches design).' },
  { name: 'frontend-executor', when: always, why: 'Exécution fidèle de la direction créative.' },
  { name: 'quality-gate-auditor', when: always, why: 'Audit implémentation vs direction créative.' },
];

export const AGENTS: AssetSpec[] = [
  { name: 'ceng-scout', when: always, why: 'Exploration/lecture volumineuse à bas coût (Haiku).' },
  { name: 'ceng-builder', when: always, why: 'Implémentation de tâches bien définies (Sonnet, effort medium).' },
  { name: 'ceng-engineer', when: always, why: 'Implémentation exigeante, débogage (Sonnet, effort high).' },
  { name: 'ceng-tester', when: always, why: 'Stratégie et écriture de tests.' },
  { name: 'ceng-reviewer', when: always, why: 'Revue ciblée ou approfondie, lecture seule.' },
  { name: 'ceng-security', when: always, why: 'Modélisation de menaces et revue sécurité.' },
  { name: 'ceng-researcher', when: always, why: 'Recherche documentaire (sources officielles d\'abord).' },
  { name: 'ceng-principal', when: always, why: 'Architecture, arbitrages, escalades (Opus).' },
  { name: 'ceng-creative-director', when: (p) => SKILLS.find((s) => s.name === 'creative-director')!.when(p), why: 'Direction créative (Opus).' },
  { name: 'ceng-frontend-executor', when: (p) => SKILLS.find((s) => s.name === 'frontend-executor')!.when(p), why: 'Exécution frontend fidèle (Sonnet).' },
  { name: 'ceng-quality-auditor', when: (p) => SKILLS.find((s) => s.name === 'quality-gate-auditor')!.when(p), why: 'Audit créatif et qualité (Opus).' },
];

export function selectAssets(specs: readonly AssetSpec[], profile: ProjectProfile): { selected: AssetSpec[]; skipped: AssetSpec[] } {
  const selected = specs.filter((s) => s.when(profile));
  return { selected, skipped: specs.filter((s) => !selected.includes(s)) };
}
