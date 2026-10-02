# Stratégies de test — quand utiliser quoi

Sources :
- Martin Fowler, *The Practical Test Pyramid* — https://martinfowler.com/articles/practical-test-pyramid.html
- Kent C. Dodds, *The Testing Trophy* — https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications
- Google, *Software Engineering at Google*, ch. 11–14 (taille des tests, hermeticité, flakiness) — https://abseil.io/resources/swe-book
- Kent Beck, *Test-Driven Development: By Example* ; Beck, *Canon TDD* (2023) — https://tidyfirst.substack.com/p/canon-tdd
- Property-based testing : QuickCheck (Claessen & Hughes, 2000) ; Hypothesis — https://hypothesis.readthedocs.io ; fast-check — https://fast-check.dev
- Contract testing : Pact — https://docs.pact.io
- Mutation testing : Stryker — https://stryker-mutator.io ; PIT — https://pitest.org ; Google, *Practical Mutation Testing at Scale* (Petrović et al., 2021)
- Playwright — https://playwright.dev/docs/best-practices
- WCAG 2.2 — https://www.w3.org/TR/WCAG22/ ; axe-core — https://github.com/dequelabs/axe-core

## Principes (non dogmatiques)

- Un test vaut par **la confiance qu'il apporte par unité de coût** (écriture, exécution, maintenance,
  flakiness). On teste les comportements observables, pas l'implémentation.
- La forme (pyramide vs trophée) dépend de l'architecture : logique riche → beaucoup d'unitaires ;
  application d'intégration (CRUD, UI) → l'intégration rapporte plus.
- Un test flaky est un bug : le réparer ou le mettre en quarantaine explicitement, jamais l'ignorer.

## Matrice de décision

| Type | Pertinent quand | Coût | Évite |
|---|---|---|---|
| Unitaire | Logique pure, calculs, règles métier, parsing | faible | Mocks qui figent l'implémentation |
| Intégration | Frontière I/O : BD, file d'attente, HTTP, système de fichiers | moyen | Mocker la BD quand une BD éphémère est disponible |
| Contrat | Plusieurs services/équipes, API publique, clients mobiles | moyen | E2E inter-services lents |
| E2E | Parcours critiques utilisateur (auth, paiement, onboarding) | élevé | Tout tester en E2E |
| Property-based | Invariants (sérialisation aller-retour, idempotence, tri, calculs financiers, parseurs) | faible-moyen | Cas d'exemples choisis à la main seulement |
| Régression | Tout bug corrigé | faible | Retour du bug |
| Sécurité | Authn/authz, entrées non fiables, secrets, dépendances | variable | Revue manuelle seule |
| Performance | SLO définis, chemins chauds, requêtes lourdes | élevé | Micro-optimisation sans mesure |
| Visuel | Design system, UI à forte exigence de cohérence | moyen | Snapshots DOM fragiles |
| Accessibilité | Toute UI publique | faible (axe) + manuel | Audit tardif |
| Mutation | Code critique dont on doute de la qualité des tests | élevé | Couverture de lignes comme seul indicateur |

## Test-first : quand ?

- **Bug** : reproduction → test de régression qui échoue → correction → validation (le test passe,
  les autres aussi). Toujours, sauf impossibilité démontrée (le noter).
- **Fonctionnalité critique** (argent, sécurité, données) : spécification → stratégie de test
  (cas nominaux, limites, erreurs, propriétés) → implémentation → validation.
- **Logique bien spécifiée** : TDD (red/green/refactor) rentable.
- **UI exploratoire** : prototype → implémentation → validation visuelle → tests adaptés
  (composants clés, parcours critiques, a11y). TDD strict y coûte plus qu'il ne rapporte.
- **Spike / recherche** : pas de tests, mais le code du spike n'est pas livré tel quel.

## Conclusions pour le framework

- Le routeur dérive une **stratégie de test** de la nature de la tâche (`bug`, `feature`, `ui`,
  `refactor`…) et de son risque, et l'explique.
- Les gates de test exécutent les commandes **réellement détectées** dans le projet (scripts npm,
  pytest, go test, flutter test…), jamais une commande générique supposée.
- Refactor : les tests existants doivent passer **avant** et **après** (comportement préservé).
- Mutation testing : proposé seulement pour les modules critiques (coût élevé).
