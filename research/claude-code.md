# Claude Code — état vérifié (octobre 2026)

Sources primaires consultées le 2026-10-02 :
- Subagents : https://code.claude.com/docs/en/sub-agents
- Hooks : https://code.claude.com/docs/en/hooks
- Skills : https://code.claude.com/docs/en/skills
- Permissions : https://code.claude.com/docs/en/permissions
- Settings : https://code.claude.com/docs/en/settings
- Modèles & effort : https://code.claude.com/docs/en/model-config
- Coûts : https://code.claude.com/docs/en/costs
- Mode non interactif / Agent SDK CLI : https://code.claude.com/docs/en/headless

Ce document ne garde que ce qui conditionne l'architecture du framework. Toute affirmation
ici a été vérifiée dans la doc officielle ; ce qui est une **déduction** est marqué comme tel.

## 1. Primitives et ce qu'elles impliquent pour le framework

| Primitive | Fait vérifié | Conséquence de conception |
|---|---|---|
| **CLAUDE.md** | Chargé intégralement à chaque session ; la doc recommande < 200 lignes et de déplacer les procédures dans des skills. | Le framework injecte un **bloc court délimité** (`<!-- ceng:begin -->`), jamais un manuel. |
| **Skills** | `SKILL.md` + fichiers annexes ; seule la `description` est toujours en contexte, le corps est chargé à l'invocation, les annexes à la lecture. Description + `when_to_use` tronquées à 1 536 caractères. Recommandation : SKILL.md < 500 lignes. | Progressive disclosure native → les connaissances vivent dans des skills, les détails dans des annexes. Installation **sélective** selon le projet (chaque description coûte du contexte permanent). |
| **Subagents** | Fichiers `.claude/agents/*.md` ; frontmatter `model` (`haiku`/`sonnet`/`opus`/`fable`/`inherit`/ID complet), `effort` (`low`→`max`), `tools`, `disallowedTools`, `skills` (préchargées), `isolation: worktree`, `background`, `maxTurns`, `memory`. Le modèle se résout dans l'ordre : paramètre d'invocation → frontmatter → `CLAUDE_CODE_SUBAGENT_MODEL` → modèle principal. | Le **modèle d'entrée ne contraint pas** les modèles d'exécution : l'orchestrateur choisit le modèle à chaque délégation (paramètre `model` de l'outil Agent). L'**effort** n'est réglable que par définition → le framework fournit des agents dont l'effort est encodé (scout=low, builder=medium, engineer/reviewer=high, principal=high). |
| **Contexte d'un subagent** | Reçoit : son prompt système, le message de délégation, CLAUDE.md, git status, skills préchargées. **Pas** l'historique de conversation. Résultat renvoyé à l'appelant ; reprise possible via `SendMessage` avec l'ID. | Chaque délégation doit être **auto-suffisante** (brief structuré). Le résultat détaillé va dans un **fichier rapport**, seul un résumé court remonte → le contexte principal reste petit sans perte d'information. |
| **Imbrication** | Subagents imbriqués jusqu'à 3 niveaux par défaut (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`), 20 concurrents max. | Les workers du framework n'ont **pas** l'outil `Agent` : l'orchestrateur garde la vision du graphe (évite l'explosion de tokens). |
| **Agent Teams** | Expérimental, désactivé par défaut (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). Lead + teammates + task list partagée + mailbox. Interactif uniquement (pas en `-p`). Une équipe par session, pas d'équipes imbriquées, teammates non restaurés par `/resume`. Coût ≈ proportionnel au nombre de teammates (~7× en plan mode). Doc : 3–5 teammates, 5–6 tâches par teammate, chacun possède ses fichiers. Quand les teams sont activées, un subagent **nommé** devient teammate. | Teams = **option**, pas défaut. Utilisées seulement si ≥ 3 lots indépendants nécessitant de la coordination, session interactive, budget non « economy ». Protocole charte/propriété de fichiers. Les délégations ordinaires ne passent pas de `name`. |
| **Hooks** | Événements utiles : `SessionStart` (matchers `startup`/`resume`/`clear`/`compact`), `PreToolUse` (décision `allow`/`deny`/`ask`), `PostToolUse`, `SubagentStart`/`SubagentStop` (bloquable), `PreCompact`, `Stop` (bloquable, champ `stop_hook_active`… cf. §3), `StopFailure` (`rate_limit`, `overloaded`…), `TaskCreated`/`TaskCompleted`/`TeammateIdle` (bloquables, exit 2), `SessionEnd`. Code 2 = blocage, stdout JSON sinon. `additionalContext` limité à 10 000 caractères. Commandes lancées via Git Bash sous Windows ; placeholder `${CLAUDE_PROJECT_DIR}`. | Les hooks sont le **plan de contrôle déterministe** : injection d'état à la reprise, garde-fous, journalisation, rapport obligatoire des subagents, checkpoint avant compaction, enregistrement des interruptions. |
| **Permissions** | Ordre d'évaluation **deny → ask → allow**, la première règle qui matche gagne ; un allow ne peut pas creuser une exception dans un deny. Règles `Read(./.env)`, `Bash(git push *)`, `WebFetch(domain:x)`, `Agent(model:opus)`. Les deny Read/Edit ne couvrent pas les sous-processus arbitraires (seul le sandbox le garantit). | Défense en profondeur : règles `deny` pour les secrets **et** hook `PreToolUse` pour les commandes destructrices ; documenté que seul le sandbox OS est une garantie forte. |
| **Modèles** | Alias `opus` → Opus 5.5, `sonnet` → Sonnet 5.5, `haiku` → Haiku 4.5, `opusplan` (Opus en plan, Sonnet en exécution). Effort par défaut `medium` sur les modèles 5.5 ; `max` « sujet à la sur-réflexion ». La doc coûts : « Sonnet handles most coding tasks well… Reserve Opus for complex architectural decisions », `haiku` pour les tâches simples de subagent. | Routage par défaut : Haiku pour exploration/synthèse mécanique, Sonnet pour l'implémentation définie, Opus pour ambiguïté/architecture/risque/escalade. Jamais `max` par défaut. |
| **Non interactif** | `claude -p`, `--output-format json` (`result`, `session_id`, `total_cost_usd`), `--json-schema`, `--permission-mode`, `--allowedTools`, `--append-system-prompt-file`, `--resume`. `--bare` ignore hooks/skills/CLAUDE.md. | `ceng run --headless` utilise `-p` **sans** `--bare` (sinon le framework ne se charge pas). Les teams ne sont pas disponibles en headless → le planner le sait. |
| **Coûts** | Agents multiples = tokens multipliés ; prompts de délégation focalisés ; arrêter les teammates finis ; déléguer les opérations verbeuses (tests, logs) à des subagents. | Principe « plus petite quantité d'intelligence suffisante » encodé dans le routeur, pas laissé à l'improvisation. |

## 2. Ce que le framework n'essaie PAS de faire

- **Remplacer** Claude Code par un orchestrateur externe (Agent SDK en boucle) : cela perdrait
  l'interactivité, les teams et les permissions natives. Le framework est un *plan de contrôle* :
  un moteur de politique déterministe (TypeScript) + des protocoles (skills/agents) + des hooks.
- Forcer le modèle principal : il est choisi au lancement (`ceng run` le recommande), puis chaque
  délégation choisit le sien. C'est exactement la séparation « modèle d'entrée / orchestrateur ».

## 3. Points d'attention vérifiés

- Les **boucles de Stop hook** : un hook `Stop`/`SubagentStop` qui bloque sans condition peut
  boucler. Le framework ne bloque qu'une fois par cycle (marqueur d'état) et seulement si une
  condition objective est fausse (rapport absent, tâche en cours sans checkpoint).
- Les **mailbox / task list d'équipe** sont gérées par Claude Code (`~/.claude/teams`, `~/.claude/tasks`)
  et ne doivent pas être pré-écrites. Le framework n'y touche pas : il garde son propre graphe de
  tâches dans le dépôt (persistant, versionné, lisible par toute session future).
- Les skills synchronisées depuis claude.ai n'exécutent pas d'injection shell (`` !`cmd` ``). Les skills
  du framework n'en dépendent donc pas : elles demandent explicitement d'appeler la CLI.
- `--bare` désactive hooks et skills : ne jamais l'utiliser pour lancer le framework.
