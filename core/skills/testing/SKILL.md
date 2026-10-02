---
name: testing
description: Choix de la stratégie de test selon le contexte — unitaires, intégration, contrat, end-to-end, property-based, régression, sécurité, performance, visuels, accessibilité, mutation. À utiliser pour décider quoi tester et comment, écrire des tests fiables, ou diagnostiquer des tests fragiles.
---

# Testing

Un test vaut par **la confiance qu'il apporte par unité de coût** (écriture, exécution, maintenance, flakiness).
On teste des comportements observables, pas l'implémentation.

## Choisir les types
| Type | Quand | Attention |
|---|---|---|
| Unitaire | logique pure, règles métier, parsing, calculs | mocks qui figent l'implémentation |
| Intégration | frontière I/O (BD, HTTP, file, fichiers) | préférer une vraie BD éphémère à un mock |
| Contrat | API consommée par d'autres (services, mobile) | versionner, tester côté consommateur et fournisseur |
| E2E | parcours critiques (auth, paiement, onboarding) | peu nombreux, stables, sélecteurs accessibles |
| Property-based | invariants : aller-retour, idempotence, montants, tri, parseurs | générateurs bornés, graine reproductible |
| Régression | tout bug corrigé | le test doit échouer sans la correction |
| Sécurité | authz, entrées hostiles, secrets | cas d'abus concrets issus du threat model |
| Performance | SLO définis, chemins chauds | mesurer avant/après, environnement stable |
| Visuel / a11y | design system, UI publique | axe automatisé + vérification clavier |
| Mutation | module critique dont on doute des tests | coûteux : cibler |

## Test-first ?
- Bug : **toujours** reproduction → test rouge → correction → vert.
- Fonctionnalité critique : spécification → stratégie de test → implémentation → validation.
- Logique bien spécifiée : TDD rentable (skill `tdd`).
- UI exploratoire : prototype → implémentation → validation visuelle → tests adaptés.
- Spike : pas de tests, mais le spike n'est pas livré tel quel.

## Fiabilité
Déterminisme : horloge, aléa, réseau, ordre et fuseaux contrôlés ; pas de `sleep` arbitraire ; données de test
construites dans le test ; isolation entre tests. Un test flaky est un bug : comprendre, corriger ou mettre en
quarantaine explicitement (tâche dédiée), jamais « relancer jusqu'au vert ».

## Exécution
Utiliser les commandes du projet (`.ceng/config.json` → commands ; `node .ceng/runtime/cli.js gate run <tâche>`).
Ne jamais affirmer qu'un test passe sans l'avoir exécuté. Sortie volumineuse → résumer (ceng-scout) plutôt que
charger dans le contexte principal.
