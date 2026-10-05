# Hooks

Tous les hooks appellent `node "${CLAUDE_PROJECT_DIR}/.ceng/runtime/hooks/run.js" <événement>` (JSON sur stdin).
Ils sont rapides, sans dépendance, et **fail-open** : une erreur interne est signalée sur stderr sans bloquer la
session. Ceux du framework sont repérés à leur chemin, donc remplacés à chaque `upgrade`, tandis que les hooks de
l'utilisateur sont conservés.

| Événement Claude Code | Gestionnaire | Rôle |
|---|---|---|
| `SessionStart` (startup/resume/clear/compact) | `session-start` | injecte le brief de reprise (`additionalContext`), compte les sessions |
| `PreToolUse` Bash/PowerShell | `guard-command` | (stade `prototype` : les actions récupérables passent sans validation, journalisées, instantané avant suppression/reset — voir `docs/security.md`) classe la commande : `deny` (interdit) / `ask` (approbation) / rien ; **suppression de fichiers** : instantané automatique puis `allow` si elle est récupérable, sinon `ask` |
| `PreToolUse` Edit/Write/MultiEdit/NotebookEdit | `guard-file` | secrets et `.git/` refusés ; gouvernance, CI et infra soumises à approbation ; **interdit à un worker d'éditer un fichier possédé par une autre tâche en cours** |
| `PreToolUse` Agent | `agent-spawn` | journalise la délégation (type d'agent, modèle, tâche, arrière-plan, taille du brief), mémorise la tâche en attente |
| `SubagentStart` | `subagent-start` | relie `agent_id` à la tâche (FIFO par type d'agent) |
| `PostToolUse` Edit/Write… (async) | `file-edited` | journalise le fichier touché (sans contenu) ; compte les modifications de la **session principale** depuis le dernier checkpoint (celles des sous-agents ne comptent pas) |
| `PostToolUse` Skill (async) | `skill-used` | mesure l'usage des skills (pour l'adaptation) |
| `SubagentStop` | `subagent-stop` | si un agent `ceng-*` termine sans bloc `CENG_REPORT` : `block` une seule fois (`stop_hook_active` évite les boucles) |
| `PreCompact` | `pre-compact` | checkpoint automatique (récit + instantané git) |
| `Stop` | `stop` | modifications de la session principale → **checkpoint automatique silencieux** (« Checkpoint automatique en fin de tour (N fichiers) », prochaine étape reprise du dernier checkpoint volontaire) ; ne bloque jamais pour un checkpoint ; au plus un rappel non bloquant (`systemMessage`) toutes les 2 h si aucun checkpoint volontaire n'a été pris depuis 2 h ; mode sans humain / pilote automatique : relance l'orchestrateur tant qu'il reste du travail non délégué (voir `docs/state-and-recovery.md`) |
| `StopFailure` | `stop-failure` | enregistre l'interruption (`rate_limit`, `overloaded`…) pour la reprise |
| `TaskCompleted` | `task-completed` | Agent Teams : refuse (exit 2) la complétion d'une tâche `T-xxxx` dont les gates requises manquent |
| `SessionEnd` | `session-end` | journalise la fin |
| `UserPromptSubmit` | `user-prompt` | l'humain est présent (annule la bascule) ; `/ceng-orchestrate` active la continuation automatique de la session |
| `PermissionRequest` | `permission-request` | remplace les boîtes de permission natives (qui n'expirent jamais) par une validation via l'invite ; reprend l'autorisation déjà consommée par `guard-command` pour la même exécution (règles `ask` natives) ; humain absent → refus consigné |
| `PreToolUse` AskUserQuestion | `ask-question` | humain absent → question mise en file, recommandation appliquée comme décision provisoire |
| `PostToolUse` AskUserQuestion (synchrone) | `question-answered` | lit l'option RÉELLEMENT choisie (l'identifiant R-xxxx doit y figurer ; la formulation de la question est libre) : approbation → autorisation de 30 min pour la même action (usage unique pour une opération destructive), refus → action bloquée ; dit à Claude quoi faire ensuite ; une réponse prouve la présence, une invite expirée signale l'absence |
| `SessionStart`, `Stop`, `SubagentStop` (async) | `graph-refresh` | graphe de code graphify : construit s'il manque, mis à jour en arrière-plan si des fichiers ont changé (début de session, fin de tour, fin d'agent) — mode code, sans coût IA, verrou anti-chevauchement |

Tester un hook à la main :

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"cat .env"}}' | node .ceng/runtime/hooks/run.js guard-command
```

Tous les hooks d'un projet sont visibles dans Claude Code avec `/hooks` (terminal interactif). Pour les désactiver
temporairement, utiliser `"disableAllHooks": true` dans `.claude/settings.local.json`. C'est une action humaine :
un agent qui tente de le faire est bloqué.
