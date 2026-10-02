# Reprise, échecs, rollback

## Reprise après interruption (contexte plein, quota, erreur API, crash, outil indisponible)
1. Le hook SessionStart injecte le brief ; sinon `ceng resume`.
2. `git status` / `git diff --stat` : l'état réel prime sur le récit.
3. Tâche `in_progress` : relis son rapport (s'il existe) et le dernier checkpoint ; reprends à « prochaine étape ».
   Teammates d'une équipe précédente : ils n'existent plus → relance les tâches non terminées à partir des rapports.
4. Outil/MCP indisponible : n'insiste pas en boucle. Contourne (CLI équivalente) ou `ceng task block` avec la
   cause, et continue les tâches indépendantes.

## Politique de tentatives
- Tentative 1 échoue → `ceng task fail <id> --reason "<cause précise, pas « ça ne marche pas »>"`.
- Tentative 2 : **stratégie différente** (consigner `--strategy` au `task start`) — jamais la même chose deux fois.
- Seuil atteint → la route impose l'escalade Opus (dossier minimal). Échec après Opus → blocage + humain.
- Cherche la cause racine : un test qui « passe parfois » est un défaut à comprendre, pas à relancer.

## Rollback
- `ceng checkpoint list` puis `ceng rollback <CP>` (aperçu) → `--apply`. Un instantané de sécurité de l'état
  courant est pris avant : le rollback est lui-même annulable. Les fichiers créés après le checkpoint sont conservés.
- Préfère « nouvelle stratégie » au rollback quand le travail partiel est sain ; rollback quand l'approche est fausse.
- Jamais `git reset --hard` / `git clean -f` / `git checkout -- .` : ces commandes exigent l'humain (le hook les bloque).
