# claude-eng-framework (`ceng`)

Framework d'ingénierie logicielle autonome pour **Claude Code**. On l'installe dans n'importe quel dépôt :
il découvre le projet, génère une configuration adaptée, puis transforme une session Claude Code en
**orchestrateur**. Cet orchestrateur délègue chaque tâche au bon modèle, agent ou équipe, vérifie la qualité
avant de déclarer « terminé », et reprend le travail après une interruption sans dépendre de l'historique
de conversation.

```bash
ceng init      # découvre le projet, pose la configuration (interactif ou --yes)
ceng run       # ouvre la session orchestrateur sur le modèle recommandé
```

## L'idée en 6 points

1. **Un seul interlocuteur.** Tu parles à la session d'entrée, qui devient l'orchestrateur. Le modèle choisi au
   départ ne limite pas l'exécution : chaque délégation choisit son modèle (Haiku, Sonnet ou Opus) et son niveau
   de réflexion.
2. **Des décisions déterministes et expliquées.** Le routage (modèle, effort, agent, revue, stratégie de test,
   gates, escalade) et la planification du parallélisme (direct, séquentiel, subagents parallèles ou Agent Team)
   sont calculés par un moteur de politique TypeScript testé, qui coûte 0 token et justifie chacun de ses choix.
   Le LLM apporte son jugement (il évalue la tâche) ; la politique en déduit une décision constante.
3. **Une mémoire hors conversation.** `.ceng/brain/` (le Project Brain) est organisé en progressive disclosure :
   un index court, puis des fichiers chargés à la demande. Les workers écrivent un rapport complet et ne renvoient
   qu'un résumé de 10 à 15 lignes. Le contexte principal reste petit sans que rien ne se perde.
4. **Des hooks comme plan de contrôle.** Ils injectent l'état à chaque reprise, refusent les actions dangereuses,
   soumettent les actions irréversibles à l'humain, journalisent qui fait quoi avec quel modèle, exigent un rapport
   de chaque agent, prennent un checkpoint avant compaction et enregistrent les interruptions.
5. **« Terminé » doit être prouvé.** Les quality gates sont sélectionnées selon le risque et exécutées avec les
   vraies commandes du projet. Une tâche ne passe `done` que si ses gates requises sont vertes, ou si une dérogation
   est explicitement justifiée et journalisée.
6. **Une adaptation qui ne devient jamais un dogme.** Seules les skills pertinentes sont installées, et des skills
   propres au projet sont générées (Stripe, Flutter, data…). Le framework s'ajuste à partir de son journal
   (`ceng adapt`), avec un échantillon minimal : une expérience isolée ne devient jamais une règle.

## Installation

Prérequis : Node ≥ 22, git, [Claude Code](https://code.claude.com/docs/en/setup).

```bash
git clone <url-du-dépôt> claude-eng-framework
cd claude-eng-framework
npm install        # compile (zéro dépendance d'exécution)
npm link           # rend la commande `ceng` disponible partout
```

Puis, dans un projet :

```bash
cd mon-projet
ceng init          # questions : risque, autonomie, budget, parallélisme… (--yes = valeurs détectées)
ceng run           # ou : ouvrir Claude Code et taper /ceng-orchestrate
```

Ce que `init` écrit dans le projet (jamais dans le code applicatif) :

- `.ceng/` : configuration, profil, Project Brain et runtime autonome (aucune installation requise pour les coéquipiers ou la CI) ;
- `.claude/skills/`, `.claude/agents/` : uniquement ce que le profil justifie ;
- `.claude/settings.json` : hooks et règles de permission, en fusion non destructive avec sauvegarde ;
- `CLAUDE.md` : un bloc court délimité ;
- `.gitignore` : exclusion des journaux.

## Documentation

| Sujet | Fichier |
|---|---|
| Architecture et cycle de vie | [docs/architecture.md](docs/architecture.md) |
| Installation, configuration, mise à jour | [docs/installation.md](docs/installation.md) · [docs/configuration.md](docs/configuration.md) |
| Orchestration, routage des modèles, subagents, Agent Teams, escalade | [docs/orchestration.md](docs/orchestration.md) |
| Project Brain, checkpoints, reprise, rollback | [docs/state-and-recovery.md](docs/state-and-recovery.md) |
| Tests, quality gates, revue | [docs/quality.md](docs/quality.md) |
| Sécurité, autonomie, légal et gouvernance | [docs/security.md](docs/security.md) |
| Hooks | [docs/hooks.md](docs/hooks.md) |
| Skills, skills projet, auto-amélioration, MCP | [docs/skills.md](docs/skills.md) |
| Observabilité | [docs/observability.md](docs/observability.md) |
| Dépannage | [docs/troubleshooting.md](docs/troubleshooting.md) |
| Étendre le framework | [docs/extending.md](docs/extending.md) |
| Validation (tests et preuves) | [docs/validation.md](docs/validation.md) |
| Recherche ayant guidé la conception | [research/](research/) |

## Commandes

```text
init | upgrade | run | doctor | profile | uninstall
task add|list|show|next|start|done|fail|block|unblock|cancel · route · plan · gate list|run|record · conflicts
status · resume · checkpoint [list] · rollback · escalate [resolve] · decision add
log · report · adapt · learn add|list|promote · skill new
```

`ceng help` détaille chaque commande, et toutes acceptent `--json`. Dans un projet initialisé, les agents
appellent la copie locale : `node .ceng/runtime/cli.js <commande>`.

## Développement du framework

```bash
npm test           # build + 68 tests (domaine, découverte sur 5 projets de démo, installation, cycle de vie, hooks, reprise)
```
