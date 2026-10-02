# Architecture

## Vue d'ensemble

```
            Humain
              │  spécification, décisions, approbations
              ▼
   Session d'entrée Claude Code  ── skill ceng-orchestrate ──►  ORCHESTRATEUR
              │                                                   │ jugement : évalue les tâches
              │  node .ceng/runtime/cli.js …                      │
              ▼                                                   ▼
   ┌──────────────────────────── plan de contrôle déterministe (TypeScript, 0 token) ─────────────┐
   │ domain/  routing (modèle, effort, agent, revue, tests, gates, escalade) · planner (parallélisme)│
   │          gates · guardrails · policy (réconciliation) · adaptation · learning · secrets       │
   │ app/     tasks · checkpoints · gates runner · escalations/ADR/teams/conflicts                 │
   │ brain/   Project Brain (.ceng/brain) : index, état, journaux                                  │
   │ hooks/   SessionStart · PreToolUse · PostToolUse · Subagent* · PreCompact · Stop · …          │
   └────────────────────────────────────────────────────────────────────────────────────────────────┘
              │ délégations (outil Agent : subagent_type + model)
     ┌────────┼──────────────┬───────────────┬────────────────┬──────────────────┐
     ▼        ▼              ▼               ▼                ▼                  ▼
  scout    builder /     tester          reviewer /       principal         creative-director /
  (Haiku)  engineer      (Sonnet)        security         (Opus : design,   frontend-executor /
           (Sonnet)                      (Sonnet/Opus)    escalades)        quality-auditor
     │  chaque worker écrit .ceng/brain/reports/<tâche>.md et renvoie un bloc CENG_REPORT court
```

## Couches du code (Clean Architecture)

| Dossier | Rôle | Dépendances autorisées |
|---|---|---|
| `src/domain/` | Politique pure : types, routage, planification, gates, garde-fous, adaptation, apprentissage, redaction | aucune I/O |
| `src/discovery/` | Découverte : détecteurs purs sur un `ScanContext` (testables en mémoire) + assemblage | domain, infra (lecture seule) |
| `src/brain/` | Stockage du Project Brain (verrous, écritures atomiques), vues compactes (INDEX, brief de reprise) | domain, infra |
| `src/app/` | Cas d'usage : tâches, checkpoints, exécution des gates, coordination | domain, brain, infra |
| `src/generation/` | Installation dans un projet : catalogue, skills projet, fusion settings/CLAUDE.md, manifeste | tout sauf cli |
| `src/hooks/` | Gestionnaires des hooks Claude Code (fail-open) | app, brain, domain |
| `src/cli/`, `src/cli.ts` | Interface ligne de commande | tout |
| `src/infra/` | fs atomique, verrou inter-processus, git (sans shell), exec, prompts | Node uniquement |
| `core/` | Contenu installé : agents, skills, catalogue de skills projet | — |

**Zéro dépendance d'exécution** : seulement Node. Cela réduit la surface de la chaîne d'approvisionnement et rend
le runtime copiable tel quel dans chaque projet (`.ceng/runtime/`).

## Cœur réutilisable vs configuration générée

- **Cœur** (dans ce dépôt) : moteur de politique, runtime, agents, skills génériques, catalogue de skills projet.
- **Généré par projet** : `.ceng/config.json` (préférences réconciliées et commandes réelles), `.ceng/profile.json`,
  Brain, sélection d'agents et de skills, skills projet en brouillon, fusion de `.claude/settings.json`, bloc `CLAUDE.md`.
- **Manifeste** (`.ceng/manifest.json`) : hash de chaque fichier géré. Un `upgrade` met à jour les fichiers non modifiés
  et **préserve** ceux que l'équipe a modifiés (la nouvelle version est déposée dans `.ceng/upgrade-conflicts/`).

## Cycle de vie

```
ceng init ──► découverte statique ─► réconciliation préférences/réalité ─► installation sélective
   │
ceng run / claude ──► SessionStart : brief de reprise injecté
   │
   ├─ premier lancement : bootstrap cognitif (spécification humaine → architecture → skills projet → graphe de tâches)
   │
   └─ boucle : plan → task start → route (phases) → délégations → gate run → task done | fail → escalade
                 checkpoints réguliers · PreCompact = checkpoint auto · StopFailure = interruption consignée
   │
ceng adapt (périodique) ──► ajustements bornés (parallélisme, revue, Opus plus tôt, skills dormantes)
```

## Décisions de conception notables (et alternatives écartées)

| Décision | Pourquoi | Alternative écartée |
|---|---|---|
| L'orchestrateur est la session Claude Code elle-même, guidée par une skill et outillée par une CLI | conserve interactivité, permissions natives, Agent Teams, MCP | orchestrateur externe via l'Agent SDK : perd les teams (non disponibles en `-p`) et l'interaction humaine |
| Le routage est une politique déterministe et non une improvisation du LLM | cohérence entre sessions, testabilité, 0 token, explicabilité | « laisser le modèle décider » : variable, coûteux, non auditable |
| L'effort est encodé dans les agents (scout low, builder medium, engineer/reviewer high) et le modèle est passé à l'invocation | Claude Code permet de choisir le modèle par invocation, mais pas l'effort | un agent par combinaison modèle × effort : trop de descriptions en contexte |
| L'état machine est en JSON avec verrou et écriture atomique, le récit en Markdown | robustesse aux workers parallèles et aux crashs | tout en Markdown : fragile à éditer par plusieurs agents |
| Les hooks sont fail-open | un bug du framework ne doit jamais bloquer le travail ; les permissions natives restent actives | fail-closed : un bug figerait la session |
| Le runtime est copié dans le projet | fonctionne pour les coéquipiers, la CI et les sessions cloud sans installation globale | commande globale obligatoire |
