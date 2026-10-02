---
name: code-reviewing
description: Revue de code proportionnée au risque (ciblée, approfondie, critique) — trouver des défauts réels avec un scénario d'échec concret, les classer (bloquant, recommandé, mineur) et proposer une correction. À utiliser pour relire un diff, une PR ou le travail d'un autre agent.
---

# Code reviewing

But : améliorer la santé du code, pas viser la perfection ni imposer ses préférences.

## Profondeur selon le risque
| Niveau | Périmètre |
|---|---|
| targeted | diff + tests du diff : correction, cas limites évidents, tests présents et significatifs |
| thorough | + conception locale, erreurs et concurrence, performance (N+1, boucles), lisibilité |
| critical | + sécurité (entrées, authz, secrets, données), intégration avec le reste, invariants d'architecture |

## Ordre de lecture
1. Comprendre l'intention (tâche, critères d'acceptation, rapport du worker).
2. Conception : est-ce la bonne approche ? (le plus coûteux à corriger tard)
3. Correction : entrées invalides, null/vide, limites, erreurs, ordre, concurrence, transactions, idempotence.
4. Sécurité : voir skill `security` si surface sensible.
5. Tests : couvrent-ils le comportement modifié ? échoueraient-ils si le code était faux ?
6. Lisibilité et cohérence avec les conventions du projet.

## Règles
- **Vérifier avant d'affirmer** : lire la fonction appelée, exécuter le test, reproduire. Pas de « peut-être ».
- Chaque constat : `fichier:ligne — défaut — scénario concret d'échec — correction proposée`.
- Classer : **bloquant** (bug, faille, régression, test manquant sur un comportement critique),
  **recommandé** (dette réelle, lisibilité notable), **mineur** (style non couvert par le linter).
- Ne pas demander de réécrire ce qui fonctionne ; ne pas confondre préférence et défaut.
- Verdict `fail` si au moins un bloquant ; sinon `pass` (les recommandés deviennent des tâches si utile).
