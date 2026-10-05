# Project Brain, checkpoints, reprise, rollback

## Project Brain (`.ceng/brain/`) — progressive disclosure

| Fichier | Contenu | Qui l'écrit |
|---|---|---|
| `INDEX.md` | objectif (4 lignes), état, tâche en cours, dernier checkpoint, prochaines tâches, blocages, escalades ouvertes, récemment terminé, pointeurs (< 70 lignes) | régénéré par la CLI |
| `objective.md` | spécification : but, utilisateurs, périmètre, contraintes, critères de succès | orchestrateur + humain |
| `project.md` | profil technique détecté + « constat de l'orchestrateur » | init + orchestrateur |
| `architecture.md` | vue d'ensemble, invariants | orchestrateur / principal |
| `decisions/ADR-*.md` | décisions | `ceng decision add` |
| `tasks.json` | graphe de tâches : évaluation, fichiers, dépendances, route, tentatives, gates | CLI uniquement (verrouillé, atomique) |
| `state.json` | tâche en cours, dernier checkpoint, interruption, liens agent ↔ tâche | CLI et hooks |
| `checkpoints.jsonl` | historique des checkpoints | CLI et hook PreCompact |
| `reports/<tâche>.md` | rapport détaillé de chaque worker | workers |
| `research/*.md` | résultats de recherche sourcés | researcher |
| `escalations/E-*.md` | dossiers ESCALATE_TO_OPUS | CLI et principal |
| `teams/TEAM-*.md` | chartes d'équipe | CLI |
| `assumptions.md`, `known-issues.md` | hypothèses et problèmes connus | orchestrateur |
| `learnings.jsonl` | leçons (auto-amélioration) | `ceng learn add` |

Ce qui est suivi : objectif, contexte, architecture, décisions, tâches (à faire, en cours, terminées), blocages,
hypothèses, recherches, problèmes connus, tests (résultats des gates), qualité, changements récents et prochaines
étapes.

## Checkpoints

```bash
node .ceng/runtime/cli.js checkpoint --task T-0004 --done "service de facturation + tests unitaires" --next "brancher le webhook" [--failed "…"]
```

Chaque checkpoint enregistre un récit (fait, prochaine étape, échec) et un **instantané git non destructif** :
un index temporaire et `write-tree` + `commit-tree`, référencé sous `refs/ceng/checkpoints/CP-xxxx`. Il inclut les
fichiers non suivis (le `.gitignore` est respecté) et ne touche ni l'index ni l'arbre de travail.

Moments de checkpoint : avant une modification risquée (`route.checkpointBefore`), après une étape significative,
avant de rendre la main (le hook `Stop` le rappelle une fois s'il y a des modifications non checkpointées), et
**automatiquement avant chaque compaction** (hook `PreCompact`).

## Reprise automatique

| Interruption | Mécanisme |
|---|---|
| Contexte plein → compaction | `PreCompact` : checkpoint auto. `SessionStart(compact)` : brief + consigne de relire le rapport en cours |
| Limite de tokens, rate limit, erreur API | `StopFailure` enregistre `interruption` dans `state.json` ; la session suivante en est informée |
| Session fermée, crash, nouvelle machine | `SessionStart(startup/resume)` injecte le brief : tâche en cours, critères, dernier échec, checkpoint, modifications non checkpointées, tâches prêtes |
| Outil ou MCP indisponible | protocole `recovery.md` : contourner ou bloquer la tâche avec sa cause, puis continuer les tâches indépendantes |

Le brief est borné (6 000 caractères) et la conversation précédente n'est jamais nécessaire. `ceng resume` en
affiche une version détaillée.

## Travail sans humain (`ceng run --unattended`)

Boucle de relances de `claude -p` avec `--permission-mode auto` et `--permission-prompts none`, ainsi que
`CENG_UNATTENDED=1` pour les hooks :
- les actions à approbation (et les questions) sont refusées et consignées dans `pending-approvals.md` : rien n'attend ;
- le hook `Stop` relance l'orchestrateur tant qu'il reste des tâches faisables **et non déléguées**. Une tâche en cours
  est déléguée quand un sous-agent la travaille (état `runningAgents`, ou `agent.spawn` récent du journal sans
  `agent.stop` correspondant, expiration 60 min) ; un sous-agent démarré sans tâche rattachée couvre une tâche en
  cours. Pas de relance quand tout est délégué ou que `maxParallel` est atteint : la fin d'un sous-agent réveille
  l'orchestrateur. Les écritures de fichiers et les instantanés automatiques ne comptent pas comme progression ;
  l'arrêt a lieu après 3 relances sans progression (changement d'état d'une tâche, rapport, checkpoint volontaire) ou
  après 300 relances ;
- un message de l'humain pendant la session (hors message de lancement) le rend présent pendant 15 min : les validations
  lui sont alors posées via l'invite au lieu d'être consignées ;
- entre deux lancements : attente après une limite d'usage ou une surcharge, arrêt après 2 lancements sans
  progression, limites en heures, en relances et en budget ;
- au retour de l'humain, le brief signale les validations en attente et l'orchestrateur les présente via l'outil de
  questions.

## Tentatives et escalade

Tentative 1 → échec consigné avec sa cause (`task fail --reason`) → tentative 2 avec une **stratégie différente**
(`task start --strategy`) → escalade vers Opus (dossier minimal) → en cas d'échec d'Opus, blocage et humain.

## Rollback

```bash
ceng checkpoint list
ceng rollback CP-0007            # aperçu des fichiers impactés, sans effet
ceng rollback CP-0007 --apply    # instantané de sécurité de l'état courant, PUIS restauration
```

Le rollback est lui-même annulable (rollback vers l'instantané de sécurité). Les fichiers créés après le checkpoint
sont conservés et signalés. Les commandes git destructives (`reset --hard`, `clean -f`, `checkout -- .`) restent
soumises à l'approbation humaine.
