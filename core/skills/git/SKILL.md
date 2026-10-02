---
name: git
description: Git comme mécanisme de traçabilité — commits atomiques et compréhensibles, branches, checkpoints non destructifs, rollback, conventions du dépôt, et opérations interdites sans humain. À utiliser pour committer, créer une branche, revenir en arrière ou préparer une PR.
---

# Git

## Commits
- Un commit = un changement logique cohérent, après validation (gates vertes). Ne pas mélanger refactor et fonctionnalité.
- Message : convention du dépôt (`.ceng/brain/project.md` → convention détectée ; Conventional Commits si utilisée).
  Sujet à l'impératif, < 72 caractères ; corps = **pourquoi**, pas la liste des fichiers. Référencer la tâche (T-xxxx).
- `git add` de fichiers précis ; vérifier `git diff --staged` ; jamais de secrets, d'artefacts générés, de `.env`.
- Hooks pre-commit : ne jamais les contourner (`--no-verify`) ; corriger la cause.

## Branches et PR
- Respecter le workflow du dépôt (trunk-based, feature branches, PR). Ne pas committer directement sur une branche
  protégée si le projet utilise des PR.
- PR : description = intention, changements, tests exécutés, risques, captures pour l'UI.

## Checkpoints et rollback (framework)
- `node .ceng/runtime/cli.js checkpoint --done … --next …` prend un instantané **non destructif** (fichiers non suivis
  compris) sous `refs/ceng/checkpoints/` sans toucher l'index ni l'arbre de travail.
- Rollback : `… rollback <CP>` (aperçu) puis `--apply` ; l'état courant est sauvegardé avant.

## Interdits sans approbation humaine
`push --force`, `reset --hard`, `clean -f`, `checkout -- .`/`restore .`, `branch -D`, `stash drop/clear`, rebase/amend
d'un historique partagé, suppression de tags/releases. Le hook de garde les intercepte. Jamais détruire
silencieusement le travail de l'utilisateur : en cas de doute, instantané d'abord.
