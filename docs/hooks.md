# Hooks

Tous les hooks appellent `node "${CLAUDE_PROJECT_DIR}/.ceng/runtime/hooks/run.js" <événement>` (JSON sur stdin).
Ils sont rapides, sans dépendance, et **fail-open** : une erreur interne est signalée sur stderr sans bloquer la
session. Ceux du framework sont repérés à leur chemin, donc remplacés à chaque `upgrade`, tandis que les hooks de
l'utilisateur sont conservés.

| Événement Claude Code | Gestionnaire | Rôle |
|---|---|---|
| `SessionStart` (startup/resume/clear/compact) | `session-start` | injecte le brief de reprise (`additionalContext`), compte les sessions |
| `PreToolUse` Bash/PowerShell | `guard-command` | classe la commande : `deny` (interdit) / `ask` (approbation) / rien |
| `PreToolUse` Edit/Write/MultiEdit/NotebookEdit | `guard-file` | secrets et `.git/` refusés ; gouvernance, CI et infra soumises à approbation ; **interdit à un worker d'éditer un fichier possédé par une autre tâche en cours** |
| `PreToolUse` Agent | `agent-spawn` | journalise la délégation (type d'agent, modèle, tâche, arrière-plan, taille du brief), mémorise la tâche en attente |
| `SubagentStart` | `subagent-start` | relie `agent_id` à la tâche (FIFO par type d'agent) |
| `PostToolUse` Edit/Write… (async) | `file-edited` | journalise le fichier touché (sans contenu), compte les modifications depuis le dernier checkpoint |
| `PostToolUse` Skill (async) | `skill-used` | mesure l'usage des skills (pour l'adaptation) |
| `SubagentStop` | `subagent-stop` | si un agent `ceng-*` termine sans bloc `CENG_REPORT` : `block` une seule fois (`stop_hook_active` évite les boucles) |
| `PreCompact` | `pre-compact` | checkpoint automatique (récit + instantané git) |
| `Stop` | `stop` | tâche en cours + modifications non checkpointées → rappel unique (anti-boucle) |
| `StopFailure` | `stop-failure` | enregistre l'interruption (`rate_limit`, `overloaded`…) pour la reprise |
| `TaskCompleted` | `task-completed` | Agent Teams : refuse (exit 2) la complétion d'une tâche `T-xxxx` dont les gates requises manquent |
| `SessionEnd` | `session-end` | journalise la fin |
| `SessionStart`, `Stop`, `SubagentStop` (async) | `graph-refresh` | graphe de code graphify : construit s'il manque, mis à jour en arrière-plan si des fichiers ont changé (début de session, fin de tour, fin d'agent) — mode code, sans coût IA, verrou anti-chevauchement |

Tester un hook à la main :

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"cat .env"}}' | node .ceng/runtime/hooks/run.js guard-command
```

Tous les hooks d'un projet sont visibles dans Claude Code avec `/hooks` (terminal interactif). Pour les désactiver
temporairement, utiliser `"disableAllHooks": true` dans `.claude/settings.local.json`. C'est une action humaine :
un agent qui tente de le faire est bloqué.
