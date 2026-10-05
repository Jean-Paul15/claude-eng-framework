# Configuration

`.ceng/config.json` est un fichier de **gouvernance**. Les agents ne peuvent pas le modifier sans approbation
humaine : le hook le classe « approval » et une règle `ask` native le protège aussi.

```jsonc
{
  "preferences": { … },        // ce que l'humain a choisi à l'init
  "policy": { … },             // préférences réconciliées avec la réalité du projet (+ notes explicatives)
  "commands": { "unit": "npm test", "lint": "npm run lint", … },   // commandes réelles des gates
  "gateTimeoutMinutes": 15,
  "installedSkills": [ … ], "installedAgents": [ … ]
}
```

## Préférences

| Clé (flag init) | Valeurs | Effet |
|---|---|---|
| `riskLevel` (`--risk`) | low · medium · high · critical | Planchers de qualité. Si la découverte détecte plus haut, le niveau détecté l'emporte, avec une explication. |
| `autonomy` (`--autonomy`) | supervised · balanced · high | supervised : tout push et tout risque ≥ 4 sont validés. high : CI et infra-as-code éditables. Les actions irréversibles sont **toujours** validées. |
| `budget` (`--budget`) | economy · balanced · quality | Seuils d'appel à Opus (+1 / 0 / −1) et effort (−1 / 0 / +1), **sauf dans les domaines critiques**. |
| `quality`, `testingDepth`, `securityDepth` | light · standard · thorough | Sélection des gates et types de tests (light est relevé en présence de domaines critiques). |
| `parallelism` (`--parallelism`) | off · subagents · teams | `teams` ajoute `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` dans settings. |
| `maxParallel` | 1-10 | Taille maximale d'un lot parallèle. |
| `modelStrategy` | adaptive · opus-orchestrator · sonnet-orchestrator | Modèle de la session d'entrée (`ceng run`). |
| `deployment` | none · staging · production-with-approval | Rappel de politique. Le déploiement reste une action à approbation. |
| `researchPolicy` | minimal · when-needed · proactive | Ajout d'une phase de recherche sur les tâches à forte nouveauté. |
| `reviewPolicy` | minimal · adaptive · always | Niveau de revue (minimal ne s'applique jamais aux domaines critiques). |

## Politique effective (`policy`)

En plus des préférences : `criticalDomains`, `orchestratorModel`, `maxAttemptsBeforeEscalation` (2, ou 1 en mode
quality) et `notes` (le *pourquoi* des écarts). Domaines toujours critiques : payments, finance, health, secrets.
Si le risque est high ou critical, les domaines sensibles détectés deviennent aussi critiques : auth, pii,
multi-tenant, upload, webhooks, ai-llm, etc.

## Stade du projet

`stage` : `production` (défaut, y compris pour un projet existant sans ce réglage) ou `prototype`. En prototype, les actions
récupérables (migrations, déploiements, suppressions, push, fichiers de garde-fous) passent sans validation, journalisées, avec
instantané avant suppression ; secrets, suppression hors du dépôt, push forcé sur une branche protégée d'un dépôt partagé,
publication et infrastructure restent soumis à l'humain (détail : `docs/security.md`). `ceng init --stage prototype`, ou
`ceng config stage prototype|production` (lecture : `ceng config stage`) ; changer le stade est une décision humaine (le hook de
garde la demande quand c'est Claude qui lance la commande). Le stade n'est jamais détecté automatiquement : assouplir les
garde-fous sur une heuristique serait plus dangereux que de demander.

## Commandes des gates

Elles sont détectées depuis le projet : scripts npm, uv/poetry/pip, go, cargo, flutter, maven/gradle, bundler,
composer, dotnet, Makefile. Elles sont modifiables dans `commands`, et la valeur éditée à la main prime sur la
détection lors d'un `upgrade`. Une gate sans commande vaut `skipped` (non bloquante) et est signalée.

La détection suit la vraie pile, dossier compris : une app Flutter dans `app/` donne `cd app && flutter build apk --debug`
(build), `cd app && flutter test` (unit) et `cd app && flutter analyze` (lint) — pas de `gradle` pour son dossier
`android/` ; des fonctions Deno testées dans `supabase/functions` ajoutent `deno test --allow-all` à la gate `unit`.
Un projet déjà initialisé garde ses anciennes commandes : `ceng config detect` affiche la configuration recommandée
(nouvelle / modifiée / conservée), `ceng config detect --apply` l'écrit dans `.ceng/config.json` (fichier de garde-fous :
validation humaine requise ; les commandes que la détection ne propose pas sont conservées).

## Graphe de code

`"codeGraph": { "enabled": true }` (défaut). Flag d'init `--code-graph on|off`, puis `ceng graph enable|disable`.
Voir [skills.md](skills.md#graphe-de-code-graphify).

## Ajustements appris

`.ceng/adaptive.json` est écrit par `ceng adapt --apply`. Il contient `maxParallel`, `reviewBump` par type de tâche,
`opusDesignKinds` et `disableHaikuImplementation`, chaque ajustement avec sa raison. On peut le supprimer pour
revenir à la politique de base.
