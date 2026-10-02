# Agents autonomes de longue durée, contexte, orchestration, reprise

Sources :
- https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- https://www.anthropic.com/engineering/building-effective-agents
- https://www.anthropic.com/engineering/multi-agent-research-system
- https://code.claude.com/docs/en/costs ; https://code.claude.com/docs/en/sub-agents
- Yao et al., *ReAct* (2022) ; Shinn et al., *Reflexion* (2023) — boucles action/réflexion
- SWE-bench / SWE-agent (Yang et al., 2024) — importance de l'interface agent-outil

## Constats clés

### Harness de longue durée (Anthropic)
- Deux rôles : un **initialiseur** prépare l'environnement (liste de fonctionnalités, script
  d'init, dépôt git), un **agent de code** progresse incrémentalement à chaque fenêtre de contexte.
- Artefacts : fichier de progression, **liste de fonctionnalités structurée (JSON) initialement
  toutes « failing »**, script `init.sh`, commits git descriptifs.
- Modes d'échec observés : déclarer le projet fini trop tôt ; laisser un état non documenté ;
  marquer une fonctionnalité terminée sans test de bout en bout ; perdre du temps à relancer l'app.
- Remèdes : critères de complétion explicites, mise à jour du fichier de progression, tests de bout
  en bout obligatoires avant « passing », routine de démarrage qui vérifie l'existant.

### Ingénierie du contexte
- Le contexte est une ressource finie à rendement décroissant (« context rot »).
- Prompts à la bonne « altitude » : heuristiques fortes, pas de logique codée en dur fragile.
- **Récupération juste-à-temps** : garder des références (chemins) et charger au besoin.
- **Compaction** + **prise de notes structurée** hors contexte (fichiers) pour la cohérence
  entre fenêtres.
- **Sous-agents** qui renvoient des résumés condensés (~1 000–2 000 tokens).

### Agents efficaces
- Préférer les workflows simples et composables ; n'ajouter de l'autonomie multi-agent que quand
  la tâche le justifie. Patterns : chaînage, routage, parallélisation, orchestrateur-workers,
  évaluateur-optimiseur.

## Décisions du framework

| Problème | Mécanisme retenu |
|---|---|
| Mémoire ne doit pas dépendre de la conversation | **Project Brain** sur disque : état machine (`tasks.json`, `state.json`) + récits compacts (Markdown) + index court (`INDEX.md`) régénéré. |
| Reprise après interruption (limite de contexte, tokens, erreur API, outil indisponible) | Hook `SessionStart` (startup/resume/clear/compact) injecte un **brief de reprise** borné ; `PreCompact` écrit un checkpoint automatique ; `StopFailure` enregistre la cause d'interruption ; `ceng resume` reconstruit : tâche active, fait, échecs + raisons, prochaine action. |
| Fin prématurée | Une tâche ne passe `done` que si ses **gates** requises ont réussi (ou dérogation justifiée et journalisée) ; critères d'acceptation obligatoires pour les tâches non triviales. |
| Perte de l'information des sous-agents | Chaque worker écrit `reports/<tâche>.md` (fait, fichiers, tests, décisions, risques, suite) et ne renvoie qu'un résumé ; un hook `SubagentStop` refuse une fois la fin si le marqueur de rapport manque. |
| Explosion de tokens | Routeur déterministe (plus petite intelligence suffisante), briefs minimaux, scouts Haiku pour la lecture volumineuse, pas d'Agent dans les workers, teams en dernier recours. |
| Boucles d'échec | Politique de tentatives : 1re tentative → nouvelle stratégie → escalade (modèle supérieur) → blocage + humain. Chaque échec est consigné avec sa cause. |
| Dérive des règles | Leçons consignées puis promues seulement avec preuves répétées (cf. skills.md). |

## Checkpointing

- Git est le mécanisme de traçabilité. Un checkpoint « snapshot » capture le travail **non commité,
  fichiers non suivis compris**, sans toucher l'arbre de travail ni l'index : index temporaire
  (`GIT_INDEX_FILE`) + `git add -A` + `write-tree` + `commit-tree`, référencé sous
  `refs/ceng/checkpoints/<id>`. Restauration : on snapshot d'abord l'état courant (rien n'est
  jamais détruit silencieusement), puis on restaure.
- Commit après validation (gates OK), messages compréhensibles, regroupement logique.
