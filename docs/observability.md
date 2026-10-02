# Observabilité du framework

Journal : `.ceng/logs/events.jsonl` (JSON par ligne, redacted, non versionné).

| Question | Où regarder |
|---|---|
| Quel agent travaille, sur quelle tâche, avec quel modèle ? | `agent.spawn` (type, modèle, tâche, arrière-plan, isolation, taille du brief) puis `agent.spawn{phase:started}` avec `agentId` |
| Pourquoi cette stratégie ? | `route.decided` (agent, effort, revue, gates, escalade, coût, **raisons**) ; `ceng route <id>` |
| Quels agents ont été lancés, quelles tâches en parallèle ? | `plan.computed` (modes, lots, tâches différées) |
| Quels tests ont été exécutés ? | `gate.result` + `.ceng/logs/gates/<tâche>-<gate>.log` |
| Quels problèmes ? | `task.failed` (raison), `guard.verdict`, `conflict.detected`, `agent.report-missing`, `session.interrupted` |
| Combien de tentatives ? | `ceng task show <id>`, `ceng report` |
| Pourquoi une escalade ? | `escalation.opened` + dossier `escalations/E-*.md` |
| Pourquoi « terminé » ? | `task.done` (preuve, gates, dérogation éventuelle) ; colonne « terminé » de `ceng report` |
| Quelles skills servent ? | `skill.used` |

Commandes :

```bash
ceng log --tail 50              # derniers événements
ceng log --task T-0004          # histoire d'une tâche
ceng log --type agent           # délégations
ceng report                     # synthèse : délégations par modèle, escalades, conflits, tâche par tâche
ceng report --json              # pour un tableau de bord externe
```

Pas de données sensibles : ni contenu de fichiers, ni prompts (seulement leur taille), ni valeurs de secrets.
