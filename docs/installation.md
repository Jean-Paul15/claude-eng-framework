# Installation et cycle d'installation

## Installer le framework (une fois par machine)

```bash
git clone <url> claude-eng-framework && cd claude-eng-framework
npm install     # le script prepare compile TypeScript → dist/
npm link        # expose `ceng`
ceng help
```

Sans `npm link`, utiliser `node <chemin>/dist/src/cli.js <commande>`.

## Initialiser un projet

```bash
cd mon-projet
ceng init                  # interactif
ceng init --yes            # valeurs recommandées par la découverte
ceng init --dry-run        # montre ce qui serait écrit, n'écrit rien
ceng init --yes --risk critical --budget economy --parallelism teams --goal "API de facturation"
```

Questions posées en mode interactif (ce sont des préférences de départ, pas des contraintes) : niveau de risque,
autonomie, budget de tokens, qualité, profondeur des tests, profondeur sécurité, parallélisme, stratégie de modèles,
permissions de déploiement, politique de recherche, politique de revue, objectif.

Une fois la découverte faite, `init` affiche ses **recommandations**. Par exemple :
« La stratégie économique est conservée pour les tâches ordinaires, mais les opérations touchant payments reçoivent
une profondeur de raisonnement, de test et de revue supérieure. »

### Fichiers écrits

| Chemin | Nature | Versionné ? |
|---|---|---|
| `.ceng/config.json` | préférences, politique effective, commandes des gates | oui |
| `.ceng/profile.json` | profil découvert | oui |
| `.ceng/brain/**` | Project Brain | oui (mémoire partagée de l'équipe) |
| `.ceng/runtime/**` | CLI et hooks (JS compilé, sans dépendance) | oui |
| `.ceng/manifest.json` | hash des fichiers gérés | oui |
| `.ceng/logs/`, `.ceng/backups/`, `.ceng/upgrade-conflicts/` | journaux, sauvegardes | non (.gitignore) |
| `.claude/agents/ceng-*.md`, `.claude/skills/*` | agents et skills sélectionnés | oui |
| `.claude/settings.json` | hooks + règles (fusion) | oui |
| `CLAUDE.md` | bloc `ceng:begin … ceng:end` | oui |

Avant toute modification, `.claude/settings.json` et `CLAUDE.md` sont sauvegardés dans `.ceng/backups/<horodatage>/`.

## Lancer

```bash
ceng run                         # claude --model <orchestrateur recommandé> "/ceng-orchestrate"
ceng run --goal "ajouter l'export CSV"
ceng run --model opus            # forcer le modèle d'entrée
ceng run --resume                # reprendre la dernière conversation (le Brain suffit de toute façon)
ceng run --headless --goal "…"   # non interactif (claude -p) : pas d'Agent Teams, actions à approbation refusées
ceng run --dry-run               # affiche la commande
```

Équivalent manuel : ouvrir `claude` dans le projet et taper `/ceng-orchestrate`.

**Premier lancement interactif** : acceptez le dialogue de confiance du dossier. Tant que le dossier n'est pas
approuvé, Claude Code ignore les règles `permissions.allow` du projet (les hooks, eux, s'exécutent).

## Mettre à jour, vérifier, désinstaller

```bash
git -C <framework> pull && npm --prefix <framework> install   # mettre à jour le framework
ceng upgrade                 # dans le projet : runtime, agents et skills mis à jour, modifications locales préservées
ceng doctor                  # santé de l'installation (node, claude, hooks, skills, version, gitignore)
ceng uninstall --yes         # retire hooks, règles, bloc CLAUDE.md, fichiers gérés non modifiés ; garde le Brain
ceng uninstall --yes --purge # supprime aussi .ceng/
```
