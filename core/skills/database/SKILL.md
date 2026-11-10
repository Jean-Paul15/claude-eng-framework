---
name: database
description: Conception et évolution de bases de données — schéma, contraintes, index, requêtes (N+1, plans d'exécution), transactions et isolation, concurrence, idempotence, migrations sûres (expand/contract, réversibles), données de production. À utiliser pour toute modification de schéma, requête non triviale, migration ou logique transactionnelle.
---

# Database

## Avant d'écrire : vérifier l'état réel
Ne jamais supposer qu'une table est vide ou qu'un schéma est connu : compter et échantillonner dans la même session,
lire l'historique des migrations (seeds/imports passés). Un « seed au cas où » sur une base pleine crée des doublons.

## Si une écriture destructive est partie sur une hypothèse fausse
**Stop.** Pas de seconde manœuvre pour « rattraper ». Instantané des lignes concernées, comparaison avec les valeurs
voulues, annulation d'abord de la partie proprement réversible, puis explication claire à l'humain **avant** toute
autre action.

## Conventions actuelles de la plateforme
Vérifier ce que l'environnement utilise réellement (variables d'environnement, noms de clés, API) au lieu de supposer
les noms hérités ; lire le nouveau nom avec repli sur l'ancien. Ex. Supabase : `sb_publishable_…` / `sb_secret_…`
remplacent `anon` / `service_role`.

## Après une opération structurante
Relancer les diagnostics disponibles (advisors sécurité et performance de la plateforme, linters SQL, `EXPLAIN` des
requêtes touchées) et corriger ce qui a été introduit avant de déclarer la tâche terminée.

## Schéma
- Les invariants vivent en base : `NOT NULL`, `UNIQUE`, `CHECK`, clés étrangères. L'application seule ne suffit pas.
- Types exacts : montants en entiers (centimes) ou `numeric`, jamais en flottant ; horodatages avec fuseau.
- Index pour les requêtes réelles (filtres, jointures, tri), pas par réflexe ; vérifier avec `EXPLAIN`.

## Requêtes
Éviter le N+1 (chargement groupé, jointures) ; pagination par curseur sur gros volumes ; pas de `SELECT *` dans le
code applicatif critique ; requêtes paramétrées uniquement.

## Transactions et concurrence
| Besoin | Moyen |
|---|---|
| Plusieurs écritures tout-ou-rien | une transaction |
| Check-then-act (solde, stock, unicité) | opération atomique en base, `SELECT … FOR UPDATE`, verrou optimiste (colonne version) ou contrainte |
| Retry sûr | clé d'idempotence + contrainte d'unicité / upsert |
| Effet externe (email, paiement) + écriture | pattern outbox ; jamais d'appel réseau long dans une transaction |
| Plusieurs systèmes | saga avec compensations ; pas de transaction distribuée implicite |
Choisir le niveau d'isolation en connaissance de cause (anomalies possibles au niveau par défaut).

## Migrations
- Réversibles quand c'est possible ; testées up **et** down sur base éphémère (gate `migration`).
- Changements cassants en **expand/contract** : ajouter → double écriture/backfill → basculer → supprimer plus tard.
- Grosses tables : éviter les verrous longs (index concurrents, backfill par lots).
- Migration ciblant la production, `DROP`, `TRUNCATE`, reset : **approbation humaine** (le hook les bloque).

## Optimisation et coûts (dès la conception, pas après la facture)
Une base qui « marche » en développement peut coûter cher en production : chaque requête, chaque ligne stockée,
chaque appel temps réel se paie (CPU, egress, lectures facturées, taille de l'instance).
- **Le schéma suit les accès réels** : lister les 5-10 requêtes chaudes (écran d'accueil, liste principale, recherche,
  tableau de bord) avant de figer les tables ; index composites dans l'ordre des filtres (égalité puis plage puis tri),
  index partiels (`WHERE deleted_at IS NULL`, `WHERE status = 'active'`), index couvrants pour les listes.
- **Ne lire que ce qu'on affiche** : colonnes explicites, pagination par curseur (keyset), comptes approximatifs
  (`reltuples`, compteur dénormalisé) au lieu de `count(*)` sur une grosse table à chaque affichage.
- **Pré-calculer ce qui est lu souvent et change peu** : colonnes dérivées maintenues par trigger, vues matérialisées
  rafraîchies par lot, compteurs agrégés ; cache applicatif avec clé et invalidation explicites.
- **Écritures groupées** : insert/upsert par lots, backfills par tranches, files d'attente pour le travail lourd
  (pas dans la requête de l'utilisateur).
- **Temps réel avec parcimonie** : s'abonner à un canal filtré, pas à une table entière ; débit limité ; préférer le
  polling espacé quand la fraîcheur à la seconde n'apporte rien.
- **Stockage** : rétention et archivage décidés (logs, événements, historiques) ; partitionnement par date quand une
  table croît sans fin ; fichiers et médias en stockage objet, jamais en base.
- **RLS / politiques** : conditions indexées (`user_id = auth.uid()` avec index sur `user_id`), fonctions de politique
  `STABLE` et appelées une fois (`(select auth.uid())`) — une politique lente se paie sur chaque ligne.
- **Connexions** : pooler (PgBouncer/Supavisor) pour le serverless ; pas de connexion par requête.
- **Mesurer** : `EXPLAIN (ANALYZE, BUFFERS)` des requêtes chaudes, statistiques (`pg_stat_statements`), advisors de la
  plateforme ; noter dans le rapport le coût attendu à l'échelle visée (requêtes/jour, taille à 12 mois).

## Le schéma s'écrit en SQL, pas en documentation
Le livrable d'une conception de données est la **migration SQL** (tables, contraintes, index, politiques, seeds de
test) — directement appliquable et testable — pas un document qui décrit des tables à recoder ensuite. Un diagramme
ER se génère depuis le schéma si quelqu'un en a besoin ; il ne le précède pas.
