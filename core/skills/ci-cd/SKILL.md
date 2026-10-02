---
name: ci-cd
description: Intégration et livraison continues — pipelines rapides et fiables, quality gates en CI, sécurité de la chaîne (secrets, permissions, actions épinglées), artefacts reproductibles, déploiements progressifs, rollback et release engineering. À utiliser pour modifier un pipeline, préparer une release ou planifier un déploiement.
---

# CI/CD

## Pipeline
- Rapide d'abord : lint/types/unitaires en parallèle, puis intégration/e2e ; cache des dépendances ; échouer tôt.
- Mêmes commandes qu'en local (celles de `.ceng/config.json`) : pas de logique cachée dans la CI.
- Reproductible : lockfiles, versions d'outils épinglées, builds hermétiques autant que possible.

## Sécurité de la chaîne (OWASP A03, SLSA)
Permissions minimales du jeton (`permissions:` explicites sur GitHub Actions) ; actions tierces épinglées par SHA ;
secrets par environnement, jamais affichés ; pas d'exécution de code non fiable (PR de forks) avec secrets ;
audit de dépendances et scan de secrets en CI.

## Livraison
- Déploiements progressifs (canary, pourcentage, feature flags) pour les changements risqués ; migrations
  expand/contract compatibles avec l'ancienne et la nouvelle version.
- Rollback documenté et testé ; versionnage (SemVer pour les bibliothèques) ; changelog.
- **Tout déploiement, publication ou release par un agent exige une approbation humaine** (politique du framework,
  `deployment` dans la config) ; modifier un fichier de pipeline exige une validation selon l'autonomie.
