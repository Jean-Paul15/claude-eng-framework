---
name: observability
description: Observabilité des services — logs structurés, métriques (RED/USE), traces distribuées (OpenTelemetry), corrélation, alertes sur symptômes, SLO, absence de données sensibles dans la télémétrie. À utiliser quand on ajoute un service, un endpoint, un job, une intégration externe ou qu'on diagnostique un incident.
---

# Observability

## Minimum pour tout code serveur nouveau
- **Logs structurés** (JSON) : niveau, message stable, identifiant de corrélation/trace, contexte métier non sensible.
  Pas de secret, jeton, mot de passe, donnée personnelle (ou masqués).
- **Erreurs** : journalisées une fois, au bon niveau, avec la cause ; pas de log-and-rethrow à chaque couche.
- **Métriques** : RED pour les requêtes (Rate, Errors, Duration), USE pour les ressources (Utilization, Saturation, Errors),
  et métriques métier clés (paiements réussis/échoués).
- **Traces** : propagation du contexte entre services (OpenTelemetry si déjà présent ou si multi-services).

## Alertes et SLO
Alerter sur les symptômes vus par l'utilisateur (taux d'erreur, latence p95/p99, file qui grossit) plutôt que sur
chaque cause ; chaque alerte doit être actionnable et documentée (runbook).

## Avant de livrer
Pour une fonctionnalité risquée : savoir répondre à « comment saura-t-on que ça casse en production ? » et
« comment revenir en arrière ? » (feature flag, rollback).
