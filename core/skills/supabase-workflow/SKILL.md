---
name: supabase-workflow
description: Flux de travail Supabase — local sous Docker pour construire et tester vite, production par migrations, ou production directe si l'humain le décide ; par le CLI ou le MCP Supabase, avec les variables d'environnement du projet. Démarrage, migrations, seed, types, fonctions, tests RLS, synchronisation avec le projet hébergé, déploiement. À utiliser dès qu'un projet utilise ou va utiliser Supabase.
---

# Supabase : vite en local, propre en production

Doc : https://supabase.com/docs/guides/local-development · CLI : https://supabase.com/docs/reference/cli/usage
(vérifier les options : le CLI évolue).

## 0. Le mode, c'est l'humain qui le dit — sinon le défaut
| L'humain dit… | Tu fais |
|---|---|
| rien de précis (défaut) | **local puis production** : tout se construit et se teste sur la pile locale Docker, la production ne reçoit que des migrations quand tout est vert |
| « local et prod » | idem, en poussant en production à chaque incrément validé |
| « on travaille sur la prod » | directement sur le projet hébergé (CLI lié ou MCP), migrations toujours versionnées dans le dépôt, checkpoint avant chaque changement de schéma |
| « local seulement » | rien ne part en production |
Outils : **CLI Supabase** (`supabase …`, lié au projet par `supabase link`) ou **MCP Supabase** (exécuter du SQL, appliquer une
migration, lister les tables, advisors, logs, déployer une fonction) — le plus direct pour la tâche. Les variables
d'environnement du projet (`.env`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, clés) s'utilisent librement par le
programme qui en a besoin, sans afficher les valeurs. En **bypass total**, la production se modifie sans demander ; sinon
une action sur le projet hébergé passe par la validation du stade (libre en prototype).

## 1. Mise en place (une fois)
- Docker démarré ; CLI à jour (sa version fixe celle du Studio local).
- `supabase init` → `supabase/config.toml` : **source de vérité des réglages** (auth, fournisseurs, URL de redirection,
  buckets `[storage.buckets.<nom>]`, fonctions). Secrets lus depuis l'environnement (`env(NOM)`), jamais en clair.
- Projet hébergé existant : `supabase login`, `supabase link --project-ref <id>`, `supabase db pull --remote` (le schéma de
  production devient une migration), `supabase db reset` → base locale au même schéma que la production.

## 2. Boucle locale (rapide, sans validation : tout est jetable)
- `supabase start` (une fois) ; Studio et boîte mail de test locale pour l'auth (`supabase status` donne les adresses).
- Schéma = **fichier de migration** : `supabase migration new <nom>` puis le SQL (tables, contraintes, index, RLS, fonctions,
  triggers). Exploré au Studio local ? `supabase db diff -f <nom>` capture le SQL.
- `supabase db reset` après chaque migration : rejoue tout + `supabase/seed.sql` en quelques secondes — c'est aussi la
  preuve que la migration s'applique sur une base vierge.
- Types régénérés à chaque changement : `supabase gen types typescript --local > <chemin>` (ou l'équivalent du client).
- Fonctions Edge : `supabase functions serve`, tests Deno à côté du code.
- Tests : `supabase test db` (pgTAP), au minimum les politiques RLS par rôle (propriétaire, autre utilisateur, anonyme,
  service) ; `supabase db lint` ; advisors sécurité et performance avant de livrer.
- Seed : données fabriquées et réalistes, en volume proche du réel pour mesurer les requêtes chaudes.

## 3. « Réplique de la prod » : le schéma, pas les données personnelles
Le schéma local = celui de la production. Les données réelles n'y vont pas par défaut (données personnelles : skill
`legal-governance`) ; besoin d'un volume réaliste → seed généré, ou extrait anonymisé et minimal si l'humain le décide.
Une modification faite au dashboard de production = dérive : la rapatrier aussitôt (`supabase db pull --remote`) et la versionner.

## 4. Livrer en production
1. En local : `db reset` propre, tests verts (RLS compris), types à jour, parcours de l'app testés contre la pile locale.
2. Dérive ? `supabase db pull --remote` ; un fichier apparaît → l'intégrer, `db reset`, retester.
3. `supabase db push --remote` (ou `apply_migration` par le MCP) ; fonctions : `supabase functions deploy <nom>` ; réglages et
   buckets selon la version du CLI.
4. Vérifier en production (tables, politiques, une requête de l'app, advisors) ; noter dans le rapport ce qui a été poussé.
Une poussée interrompue est signalée au démarrage suivant (journal d'intention) : vérifier l'état réel
(`supabase migration list --linked`) avant de relancer.

## 5. Migrations qui tiennent des années
- Expand/contract pour tout changement cassant (skill `database`) ; jamais de `DROP` d'une colonne encore lue par une version
  de l'app en circulation (une app mobile ancienne vit des mois).
- Index `concurrently` sur les grosses tables ; backfill par lots ; pas de données de démonstration dans une migration (→ `seed.sql`).
- Ne jamais réécrire une migration déjà appliquée en production : en ajouter une nouvelle.

## 6. Pièges
- Clés : `sb_publishable_…` côté client, `sb_secret_…` côté serveur seulement (repli sur `anon` / `service_role` si le projet
  les utilise encore).
- `config.toml` local différent de la production (fournisseurs d'auth, redirections, limites) → bug qui n'existe qu'en
  production : `config.toml` reste la référence.
- Seed relancé sur une base peuplée → doublons (le seed ne vise que la base locale).
- Pile figée ou ports occupés : `supabase stop` puis `supabase start`.
