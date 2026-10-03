# Skills, skills projet, auto-amélioration, MCP

## Chargement progressif (natif Claude Code)

Seule la `description` d'une skill est en contexte en permanence. Claude charge le corps automatiquement quand la
tâche correspond, et les annexes uniquement quand il les lit. Le framework ajoute deux leviers :
- **installation sélective** : une skill non pertinente pour le profil n'est pas installée, donc sa description ne
  coûte rien ;
- **préchargement ciblé** : certains agents préchargent la skill de leur rôle (`code-reviewing` pour le reviewer,
  `security` pour la sécurité, les trois skills créatives pour leurs agents).

## Catalogue du cœur

| Toujours | Selon le profil |
|---|---|
| ceng-orchestrate, ceng-skill-forge, software-engineering, architecture, testing, tdd, debugging, code-reviewing, security, legal-governance, git, documentation, research | threat-modeling (surface sensible/API), database (BD/ORM/migrations), api-design, backend (serveur), frontend, accessibility (UI), performance (UI/serveur/data/mobile), observability (service déployé), ci-cd (CI/déploiement), creative-director + frontend-executor + quality-gate-auditor (produit avec UI) |

Règle de sélection : `src/generation/catalog.ts`. La skill `code-review` du framework s'appelle `code-reviewing`
pour ne pas masquer la commande intégrée `/code-review` de Claude Code.

## Chaîne créative (UI)

1. **creative-director** (agent Opus) : en phase de planification. Analyse le produit et produit
   `docs/CREATIVE_DIRECTION.md`, `DESIGN_SYSTEM.md`, `MOTION_SYSTEM.md`, `UX_PRINCIPLES.md`, `FRONTEND_GUIDELINES.md`
   et la section « VISION DU SITE ». Ne développe pas les pages.
2. **frontend-executor** (workers Sonnet, éventuellement en équipe) : lit systématiquement ces documents avant de
   coder et n'invente jamais le design. Il signale les contradictions au lieu de trancher seul. La route choisit
   automatiquement cet exécutant pour les tâches `ui` dès que `docs/CREATIVE_DIRECTION.md` existe.
3. **quality-gate-auditor** (agent Opus) : en phase de revue. Compare l'implémentation aux documents et produit un
   rapport classé (corrections importantes, améliorations, détails) avec des corrections précises. L'orchestrateur
   les transforme en tâches pour les exécutants. Il ne réécrit pas le code, mais peut mettre à jour la référence quand
   une décision d'implémentation s'avère meilleure.

## Skills spécifiques au projet

`ceng init` compare le profil au catalogue `core/project-skills.json` (Stripe, Flutter, React Native, pipelines de
données, PostgreSQL, Supabase, Firebase, intégration LLM) et génère une skill **brouillon**
(`metadata.ceng-status: draft`). Elle contient ce qui a été détecté (versions, commandes), les points d'attention,
une check-list, les pièges, la documentation officielle et une section « Recherche à compléter ». Au bootstrap,
l'orchestrateur fait vérifier ces points par `ceng-researcher`, puis passe la skill en `verified`.

Une skill projet est créée **une seule fois** et appartient ensuite au projet : elle n'est jamais écrasée.

## Auto-amélioration contrôlée (skill `ceng-skill-forge`)

1. Rétrospective courte après une tâche importante → `ceng learn add --topic <clé stable> --lesson … [--source URL] [--skill cible]`.
2. `ceng learn promote` ne propose que les leçons vues sur **≥ 3 tâches distinctes** ou adossées à une **source
   primaire**. Une expérience isolée ne devient jamais une règle.
3. La promotion modifie la skill la plus proche, avec le domaine de validité et les contre-indications. Hors
   autonomie high, l'humain valide ; une règle d'équipe donne lieu à un ADR.
4. `ceng adapt` signale les skills jamais utilisées. On peut alors passer leur visibilité en `name-only` via
   `skillOverrides` dans `.claude/settings.local.json`.

## Graphe de code (graphify)

- `ceng init` construit le graphe du code (`graphify extract --code-only`) : analyse syntaxique locale, **aucun appel
  IA, aucun coût**, quelques secondes. Si graphify est absent, init propose de l'installer (paquet Python `graphifyy`
  via uv, pipx ou pip ; `--install-graphify` en non interactif).
- Les hooks le tiennent à jour **automatiquement et en arrière-plan** (`graphify update`) : au début de chaque session
  (le code a pu changer hors de Claude), à la fin de chaque tour et à la fin de chaque agent s'il y a eu des
  modifications. Aucune latence ajoutée, verrou contre les mises à jour simultanées, journal dans `.ceng/logs/graphify.log`.
- Usage au jugement : les agents interrogent le graphe (`graphify query/path/explain/affected/god-nodes`, autorisés
  sans prompt) pour les questions de structure, et utilisent grep pour les tâches ciblées.
- `ceng graph status|install|build|enable|disable`. `graphify-out/` est local (dans `.gitignore`).
- L'enrichissement sémantique (documentation, images, liens inférés via `/graphify`) utilise un LLM : il reste une
  action volontaire.

## MCP

- La découverte lit `.mcp.json` et liste les serveurs dans `project.md`, pour que l'orchestrateur sache quelles
  intégrations existent (navigateur, base, tickets…).
- Claude Code diffère par défaut le chargement des définitions d'outils MCP (seuls les noms entrent en contexte) : pas de
  surcoût tant qu'ils ne servent pas. Quand une CLI équivalente existe (`gh`, `aws`…), elle reste plus économe.
- Un agent peut restreindre ses serveurs (`mcpServers` dans sa définition) ; `ceng-researcher` utilise WebSearch et
  WebFetch.
- Les actions MCP irréversibles (envoi, publication, suppression) relèvent de l'approbation humaine, comme les
  commandes équivalentes.
