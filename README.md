# claude-eng-framework (`ceng`)

Framework d'ingénierie logicielle autonome pour **Claude Code**. On l'installe dans n'importe quel dépôt :
il découvre le projet, génère une configuration adaptée, puis transforme une session Claude Code en
**orchestrateur**. Cet orchestrateur délègue chaque tâche au bon modèle, agent ou équipe, vérifie la qualité
avant de déclarer « terminé », et reprend le travail après une interruption sans dépendre de l'historique
de conversation.

## Démarrage rapide

### 1. Installer (une seule fois par machine)

Prérequis : [Node.js](https://nodejs.org) 22 ou plus récent, git et [Claude Code](https://code.claude.com/docs/en/setup)
(terminal, Claude Desktop onglet Code, ou web).

```bash
# Apprend à Claude à installer et gérer le framework, dans n'importe quel projet
npx skills add Jean-Paul15/claude-eng-framework -s ceng-setup -g -a claude-code -y

# Facultatif : rend la commande `ceng` disponible partout
npm install -g github:Jean-Paul15/claude-eng-framework
```

### 2. Démarrer un projet (Claude Desktop ou terminal)

1. **Ouvre le dossier du projet** (vide ou existant) dans Claude Desktop, onglet **Code**, ou lance `claude`
   dedans. Accepte la confiance du dossier si elle t'est demandée.
2. **Dis à Claude :** « Installe le framework claude-eng-framework dans ce projet. »
   Il te pose quelques questions en un seul message (niveau de risque, autonomie, budget, parallélisme, objectif,
   graphify), installe le framework, te montre ses recommandations et vérifie que tout fonctionne.
3. **Lance l'orchestrateur avec ton projet :**
   ```text
   /ceng-orchestrate Je veux une appli de réservation pour un salon de coiffure, avec paiement en ligne.
   ```
   Il pose les questions de cadrage une fois (utilisateurs, périmètre, contraintes, critères de succès), conçoit
   l'architecture, découpe le travail en tâches et commence.
4. **Tu suis et tu valides.** Il ne revient vers toi que pour les décisions qui te reviennent et les actions sensibles
   (déploiement, données de production, licences). Si tu fermes la session, la suivante reprend là où il s'était arrêté.

Sans passer par Claude, l'équivalent en terminal, depuis le dossier du projet :

```bash
npx github:Jean-Paul15/claude-eng-framework init    # ou `ceng init` si installé globalement
ceng run                                             # ouvre Claude Code en mode orchestrateur
```

### 3. Au quotidien

| Tu veux… | Tu fais… |
|---|---|
| Faire avancer le projet en autonomie | `/ceng-orchestrate` (avec une consigne si tu veux) |
| Le laisser travailler sans toi (la nuit) | `ceng run --unattended` dans un terminal (voir ci-dessous) |
| Savoir où en est le projet | demander à Claude « où en est le projet ? », ou `ceng status` |
| Une petite modification ou une question | parler à Claude normalement : le framework reste actif en arrière-plan |
| Comprendre pourquoi une décision a été prise | `ceng report`, `ceng log --task T-0004`, `ceng route T-0004` |
| Vérifier l'installation | `ceng doctor` |
| Mettre à jour le framework dans le projet | `npx -y github:Jean-Paul15/claude-eng-framework upgrade` |
| Reprendre sur une autre machine | cloner le dépôt et ouvrir Claude : rien à installer (le runtime est dans `.ceng/runtime/`) |

Dans un projet, `ceng` peut toujours être remplacé par `node .ceng/runtime/cli.js`.

### 4. Travailler la nuit, sans toi

```bash
ceng run --unattended                                   # jusqu'à 10 h, 30 relances
ceng run --unattended --max-hours 8 --max-budget-usd 20 # avec limites explicites
```

- **Rien n'attend jamais une réponse.** Une action qui demanderait ton accord (déploiement, push forcé…) est
  refusée proprement et notée dans `.ceng/brain/pending-approvals.md`. Ses questions y sont aussi, avec l'hypothèse
  provisoire retenue. Claude passe aux tâches indépendantes.
- **Pas d'arrêt en cours de route.** Il enchaîne les tâches tant qu'il en reste de faisables et qu'il progresse. Il
  s'arrête quand tout est fait ou bloqué, ou quand il ne progresse plus.
- **Les interruptions sont gérées.** Après une limite d'usage ou une surcharge, il attend (15 min par défaut) puis
  reprend depuis la mémoire du projet.
- **Au réveil**, ouvre Claude : il te présente via l'invite de questions ce qui attend ta validation, puis applique
  tes réponses. `ceng report` détaille la nuit.

Lance le mode nuit dans un terminal plutôt que dans une session de Claude Desktop. Une session interactive s'arrête
sur la moindre invite de permission ; le mode `--unattended` est conçu pour ne jamais en afficher.

## L'idée en 7 points

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
6. **Un graphe de code toujours à jour.** Le graphe [graphify](https://github.com/Graphify-Labs/graphify) est construit à
   l'init et mis à jour automatiquement en arrière-plan, sans coût IA. Les agents l'interrogent pour les questions
   d'architecture au lieu de relire le code.
7. **Une adaptation qui ne devient jamais un dogme.** Seules les skills pertinentes sont installées, et des skills
   propres au projet sont générées (Stripe, Flutter, data…). Le framework s'ajuste à partir de son journal
   (`ceng adapt`), avec un échantillon minimal : une expérience isolée ne devient jamais une règle.

## Installation détaillée

Prérequis : Node ≥ 22, git, [Claude Code](https://code.claude.com/docs/en/setup).

**Framework complet** (CLI, hooks, agents, skills, Project Brain), directement depuis GitHub, dans le projet cible :

```bash
npx github:Jean-Paul15/claude-eng-framework init
```

Ou en installation globale, qui rend la commande `ceng` disponible partout :

```bash
npm install -g github:Jean-Paul15/claude-eng-framework
```

**Skills seules**, sans le framework, via l'écosystème [skills](https://github.com/vercel-labs/skills) :

```bash
npx skills add Jean-Paul15/claude-eng-framework -g -a claude-code -y                        # toutes les skills
npx skills add Jean-Paul15/claude-eng-framework -s creative-director -g -a claude-code -y    # une seule
```

Les skills `ceng-orchestrate` et `ceng-skill-forge` ont besoin du framework complet. Les autres (testing, security,
creative-director, frontend-executor, quality-gate-auditor…) sont autonomes.

**Depuis les sources** :

```bash
git clone https://github.com/Jean-Paul15/claude-eng-framework && cd claude-eng-framework
npm install && npm link
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

## Pour les agents IA (Claude Code)

Si l'on te demande d'installer ce framework dans un projet, suis la skill
[`core/skills/ceng-setup/SKILL.md`](core/skills/ceng-setup/SKILL.md). En résumé :

1. `ceng --version`, sinon préfixer les commandes par `npx -y github:Jean-Paul15/claude-eng-framework`.
2. `init --dry-run` pour voir la détection.
3. Poser à l'humain, en un seul message, ses choix de risque, d'autonomie, de budget, de parallélisme, l'objectif et
   s'il veut graphify.
4. `init --yes --risk … --autonomy … --budget … --parallelism … --goal "…" --install-graphify`.
5. Montrer les recommandations, puis `doctor`, puis `/ceng-orchestrate`.

Un projet déjà initialisé fonctionne sans installation : la CLI est dans `.ceng/runtime/` et les consignes dans son
`CLAUDE.md`. Pour rendre cette procédure disponible partout sur une machine :
`npx skills add Jean-Paul15/claude-eng-framework -s ceng-setup -g -a claude-code -y`.

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
npm test           # build + 83 tests (domaine, découverte sur 5 projets de démo, installation, cycle de vie, hooks, reprise)
```

## Licence

[Apache License 2.0](LICENSE) — Copyright 2026 Jean-Paul ADOGLI. Voir aussi [NOTICE](NOTICE).
