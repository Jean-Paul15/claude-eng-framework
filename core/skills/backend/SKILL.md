---
name: backend
description: Ingénierie serveur — structure des services et handlers, validation aux frontières, gestion des erreurs, configuration, timeouts et retries, files et tâches asynchrones, cache, idempotence, sécurité serveur. À utiliser pour écrire ou modifier du code serveur, des workers, des jobs ou des intégrations.
---

# Backend

## Structure
Handler mince (parse/valide → appelle la logique → formate la réponse) ; logique métier testable sans HTTP ni BD ;
accès aux données et clients externes derrière des fonctions/modules dédiés. Suivre la structure existante du projet.

## Robustesse
- **Timeouts** sur tout appel réseau ; **retries** seulement sur erreurs transitoires, avec backoff exponentiel + jitter
  et budget ; jamais de retry non idempotent sans clé d'idempotence.
- Jobs asynchrones : idempotents, rejouables, avec visibilité (statut, erreurs) ; message empoisonné → file d'erreurs.
- Concurrence : pas d'état global mutable partagé entre requêtes ; atomicité en base (skill `database`).
- Arrêt propre (signaux, connexions, jobs en cours).

## Configuration et secrets
Configuration par environnement, validée au démarrage (échouer tôt si manquante) ; secrets via variables
d'environnement/gestionnaire, jamais dans le code ni les logs.

## Performance
Pas d'I/O en boucle (N+1) ; cache seulement avec stratégie d'invalidation claire et besoin mesuré ; streaming pour les
gros volumes ; pagination.

## Observabilité
Logs structurés avec identifiant de corrélation, erreurs avec contexte (sans données sensibles) — skill `observability`.
