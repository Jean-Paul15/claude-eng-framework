---
name: api-design
description: Conception d'API (REST, GraphQL, RPC, événements) — ressources et contrats, validation, erreurs structurées (RFC 9457), pagination, idempotence, versionnement, autorisation par ressource, compatibilité. À utiliser pour créer ou modifier un endpoint, un schéma, un contrat entre services ou avec un client mobile.
---

# API design

## Contrat d'abord
Écrire/mettre à jour le contrat (OpenAPI, schéma GraphQL, protobuf, types partagés) **avant** l'implémentation
quand plusieurs consommateurs ou agents en dépendent ; le figer avant de paralléliser (`--interfaces`).

## Règles par défaut
- Noms de ressources stables et cohérents avec l'existant ; sémantique HTTP correcte (RFC 9110) : GET sûr, PUT/DELETE
  idempotents, POST non idempotent → **clé d'idempotence** pour les opérations sensibles (paiement, création unique).
- Validation stricte des entrées à la frontière (schéma), rejet explicite des champs inconnus si le projet le fait.
- Erreurs structurées et stables (Problem Details RFC 9457) : code machine, message humain, sans fuite interne.
- Pagination (curseur pour les gros volumes), limites de taille, rate limiting.
- **Autorisation par objet** sur chaque endpoint (BOLA = risque n°1 de l'OWASP API Top 10) ; pas de propriétés
  sensibles exposées ou modifiables par affectation de masse.
- Compatibilité : ajouter est sûr ; supprimer/renommer/changer un type est cassant → versionner ou déprécier avec délai.

## Tests
Tests de contrat quand le consommateur est ailleurs (gate `contract`) ; tests d'intégration des cas d'erreur et
d'autorisation, pas seulement du chemin heureux.
