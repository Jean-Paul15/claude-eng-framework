---
name: tdd
description: Procédure test-driven development (rouge, vert, refactor) et ses variantes (test de régression pour un bug, tests de caractérisation avant refactor). À utiliser quand la route indique test-first ou quand un comportement est bien spécifié.
---

# TDD — quand c'est rentable

Rentable pour : logique bien spécifiée, bug à corriger, fonctionnalité critique, refactor de code mal testé.
Peu rentable pour : UI exploratoire, spike, intégration d'une API inconnue (spike d'abord, tests ensuite).

## Cycle (Canon TDD, K. Beck)
1. Liste de scénarios de test (comportements, cas limites, erreurs) — la liste évolue.
2. Prends **un** scénario, écris un test concret qui échoue **pour la bonne raison** (lire le message d'échec).
3. Fais-le passer avec le changement le plus simple.
4. Refactore (code et test) tant que tout est vert. Pas de nouvelle fonctionnalité pendant le refactor.
5. Recommence jusqu'à épuisement de la liste.

## Variantes
- **Bug** : test qui reproduit le bug (rouge) → correction de la cause racine → vert → la suite entière reste verte.
- **Refactor** : tests de caractérisation qui figent le comportement actuel (même étrange) → refactor → mêmes tests verts.
  Un comportement à changer = une tâche distincte.
- **Propriété** : énoncer l'invariant (« décoder(encoder(x)) = x ») avant d'écrire le code.

## Pièges
Tester l'implémentation (appels internes) plutôt que le comportement ; un test qui passe dès son écriture
(il ne prouve rien) ; mocks en cascade ; tests trop gros qui testent plusieurs scénarios.
