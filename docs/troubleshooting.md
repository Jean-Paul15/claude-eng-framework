# Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| `ceng: command not found` | framework non lié | `npm link` dans le dépôt du framework, ou `node <chemin>/dist/src/cli.js` |
| « Ignoring N permissions.allow entries… not been trusted » | dossier jamais approuvé dans Claude Code | ouvrir `claude` une fois en interactif dans le projet et accepter la confiance |
| Le brief `[ceng]` n'apparaît pas au démarrage | hooks absents ou désactivés | `ceng doctor` ; `ceng upgrade` ; vérifier `disableAllHooks` dans les settings |
| `Framework non initialisé` dans un hook ou la CLI | mauvais répertoire | lancer depuis la racine du projet ou passer `--dir` |
| `task done` refusé | gates requises non vertes | `ceng gate run <id>` ; gates de revue : `ceng gate record … --note` ; en dernier recours `--waive "raison"` |
| Gate `skipped` « aucune commande détectée », ou gate qui lance une commande qui ne correspond pas à la pile (ex. `gradle` pour une app Flutter) | outil absent, ou configuration antérieure à la détection | `ceng config detect` puis `ceng config detect --apply` (validation humaine) ; sinon éditer `.ceng/config.json` → `commands` |
| Verrou `tasks.json.lock` non obtenu | processus ceng tué pendant une écriture | le verrou expire après 15 s ; sinon supprimer le fichier `.lock` |
| Les teammates n'apparaissent pas | teams non activées ou session non interactive | `--parallelism teams` à l'init ; session interactive ; voir la doc Agent Teams |
| Des subagents deviennent des teammates | Claude a passé `name` alors que les teams sont activées | brief sans `name` (cf. delegation.md) ou désactiver les teams |
| Un agent tourne en rond | même stratégie répétée | `ceng task fail --reason` puis stratégie différente ; l'escalade se déclenche automatiquement |
| Fichiers en double après un rollback | fichiers créés après le checkpoint (conservés par sécurité) | les supprimer manuellement s'ils sont indésirables (liste affichée par `rollback`) |
| `upgrade` n'a pas mis à jour une skill | modifiée localement → préservée | comparer avec `.ceng/upgrade-conflicts/` et fusionner à la main |
| Fins de ligne modifiées après rollback (Windows) | `core.autocrlf` | comportement git normal ; le contenu est identique |
