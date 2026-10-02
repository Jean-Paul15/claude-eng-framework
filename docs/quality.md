# Tests, quality gates, revue

## Stratégie de test choisie par contexte

La route détermine le flux et les types de tests (détails dans la skill `testing`) :

| Tâche | Flux | Test-first |
|---|---|---|
| bug | reproduction → test de régression rouge → correction → validation | oui |
| feature critique | spécification → stratégie de test → implémentation → validation (unit + intégration + propriétés + e2e) | oui |
| feature ordinaire | implémentation + tests ciblés (stratégie d'abord si complexité ≥ 3) | si complexe et bien spécifiée |
| ui | prototype → implémentation → validation visuelle → tests adaptés (composants, a11y) | non |
| refactor | tests de caractérisation verts avant et après | oui |
| migration | up/down sur base éphémère → validation des données → intégration | oui |
| security | cas d'abus (rouges) → correctif → validation | oui |
| research, design, docs | pas de tests (livrable documentaire) | — |

Les tests de propriétés sont ajoutés pour les domaines payments, finance, serialization, parsing et concurrency.

## Quality gates adaptatives

| Gate | Type | Sélectionnée quand |
|---|---|---|
| build, typecheck, unit, secrets | commande / intégrée | tout changement de code |
| lint | commande | code, risque ≥ 2 ou qualité ≠ light |
| integration | commande | risque ≥ 3, complexité ≥ 3, critique ou migration (requise si critique ou risque ≥ 4) |
| migration | commande | kind migration ou domaine database-migration |
| contract | commande | domaine api avec contrat partagé ou impact ≥ 3 |
| e2e | commande | domaine critique |
| deps-audit | commande | surface sensible, critique, ou securityDepth thorough |
| compliance | intégrée | domaines légaux (pii, health, payments, finance, ai-llm, analytics, licensing, dependencies) |
| accessibility, ux, visual | agent | UI |
| performance | commande | domaine performance / hot-path |
| docs | agent | kind docs, ou feature à impact architectural |
| review, security-review, architecture-review | agent | selon le niveau de revue |
| report | intégrée | toute tâche déléguée |
| human-approval | humain | route `humanApproval` |

- `ceng gate run <tâche>` exécute les gates de type commande avec les **vraies commandes du projet**. Une même
  commande partagée par deux gates n'est exécutée qu'une fois. La sortie est redacted dans `.ceng/logs/gates/`.
- Gates intégrées : `secrets` (scan du diff et des fichiers non suivis), `compliance` (licence du projet, licences
  des dépendances npm directes, rappels RGPD/IA), `report` (rapport présent).
- Gates agent/humain : réalisées par l'agent indiqué, puis enregistrées avec
  `ceng gate record <tâche> <gate> pass|fail --note "…"`.
- **`ceng task done` refuse** tant qu'une gate requise n'est pas pass, skipped ou waived. `--waive "raison"` est
  possible, mais journalisé et visible dans `ceng report`.
- Le hook `TaskCompleted` (Agent Teams) applique la même règle aux tâches d'équipe portant un ID `T-xxxx`.

## Budget de revue

| Taille | Chaîne |
|---|---|
| petite modification | worker → tests → done |
| fonctionnalité moyenne | worker → tests → revue ciblée → done |
| fonctionnalité critique | workers → tests → revue sécurité → revue d'architecture → intégration → gates |

La revue cherche des défauts réels, avec un scénario d'échec concret, classés en bloquant, recommandé ou mineur
(skill `code-reviewing`). L'étape *refine* corrige les bloquants, puis on re-teste.
