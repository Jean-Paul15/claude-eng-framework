# Bootstrap cognitif (premier lancement)

`ceng init` a fait la découverte statique (stack, commandes, risques, skills). Il reste ce qu'un outil
statique ne peut pas voir. Objectif : un projet compris et un graphe de tâches exécutable, à coût maîtrisé.

1. **Spécification** (seule interaction longue avec l'humain) : si `objective.md` est vide, demande en
   une fois : but, utilisateurs, périmètre in/out, contraintes (délais, conformité, plateformes, budget),
   critères de succès mesurables, accès externes (MCP, comptes de test), actions qu'il veut valider lui-même.
   Consigne dans `.ceng/brain/objective.md`. Hypothèses faites à sa place → `assumptions.md`.
2. **Recommandation de configuration** : relis `project.md` (section « Politique effective »). Si la réalité
   du projet contredit les préférences (ex. budget economy mais paiements), explique la nuance à l'humain ;
   ne change `.ceng/config.json` qu'avec son accord (fichier de gouvernance).
3. **Compréhension de l'existant** (projet non vide) : délègue à `ceng-scout` une cartographie ciblée
   (points d'entrée, modules, flux principaux, zones fragiles). Rédige `architecture.md` (vue d'ensemble,
   invariants) et complète « Constat de l'orchestrateur » dans `project.md`. Ne lis pas tout le repo toi-même.
4. **Skills projet en brouillon** (`.claude/skills/*` avec `ceng-status: draft`) : pour celles qui
   conditionnent les premières tâches, délègue à `ceng-researcher` la vérification des points de la section
   « Recherche à compléter », puis mets à jour la skill (skill `ceng-skill-forge`).
5. **Architecture cible** (projet neuf ou évolution majeure) : si l'ambiguïté ou l'impact sont élevés, délègue
   la conception à `ceng-principal` (Opus) → ADR + découpage. Sinon décide toi-même, simplement.
6. **Produit avec UI** : si une direction créative est nécessaire et absente (`docs/CREATIVE_DIRECTION.md`),
   crée une tâche `--kind design` routée vers `ceng-creative-director` avant toute tâche UI.
7. **Graphe de tâches** : `ceng task add …` pour chaque livrable, avec dépendances, fichiers, critères,
   domaines. Les fonctionnalités démarrent toutes « pending » : rien n'est fait tant que les gates ne l'ont pas prouvé.
8. `ceng status`, puis présente le plan à l'humain en 10 lignes max et commence la boucle.
9. **Projet vide à l'init** (profil `unknown`, peu de skills) : dès que la stack est posée (manifeste, framework,
   base, CI), lance `ceng upgrade` — la découverte est refaite, les skills/agents pertinents et les commandes des
   gates sont installés, les préférences de l'humain sont conservées.
