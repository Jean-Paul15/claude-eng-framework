# Cycle itératif proportionné

Cycle complet pour les fonctionnalités importantes :
UNDERSTAND → PLAN → IMPLEMENT → TEST → REVIEW → REFINE → TEST → SECURITY REVIEW → QUALITY GATE → DONE

La route (`ceng route`) en sélectionne les phases selon le risque. Repères :

| Situation | Chaîne |
|---|---|
| Petite modification | worker → tests → done |
| Fonctionnalité moyenne | worker → tests → revue ciblée → done |
| Fonctionnalité critique | threat-model → conception (Opus) → spec de test → workers → tests → revue sécurité → revue d'architecture → intégration → gates → (humain si requis) |
| Bug | reproduction → test de régression rouge → correction de la cause racine → validation |
| UI exploratoire | prototype → implémentation → validation visuelle → tests adaptés (+ a11y) |
| Refactor | tests de caractérisation verts → refactor → mêmes tests verts |
| Fin de phase parallèle | workers → tests individuels → intégration → détection de conflits → revue ciblée → gates |

## Refine
Après la revue : corriger les constats **bloquants** (puis re-tester), traiter les « recommandés » s'ils sont
peu coûteux ou liés au risque, noter les « mineurs » sans bloquer. Ne pas réécrire ce qui fonctionne.

## Terminé = prouvé
Une tâche est terminée quand ses gates requises sont vertes et ses critères d'acceptation vérifiés.
Une dérogation (`--waive`) est possible mais journalisée, visible dans `ceng report`, et doit être justifiée
(ex. « outil e2e absent du projet : tâche T-0012 créée pour l'ajouter »).
