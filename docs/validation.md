# Validation du framework

« Les fichiers existent » ne prouve rien. Voici ce qui est testé, et comment.

## Suite automatisée (`npm test`, 83 tests, Node test runner, sans dépendance)

| Fichier | Ce qui est prouvé |
|---|---|
| `test/routing.test.ts` | Sélection de modèle et d'effort (Haiku pour les tâches mécaniques, Sonnet pour l'implémentation, Opus pour la conception ambiguë ; **Opus conçoit, Sonnet implémente**) ; exécution directe des tâches triviales ; seuils economy/quality ; **planchers critiques malgré l'économie** (paiements) ; stratégies de test (bug, UI, critique) ; agent frontend dédié en présence d'une direction créative ; escalade Sonnet → Opus → humain ; explication et coût relatif ; approbation légale ; effet de l'adaptation. |
| `test/planner.test.ts` | Globs et recouvrement ; graphe et cycles ; séquentiel pour une tâche unique ; subagents parallèles pour des tâches indépendantes ; **jamais deux tâches au même périmètre en parallèle** ; direct pour le trivial ; **Agent Team uniquement sous ses 5 conditions** ; maxParallel et adaptation ; worktree pour un périmètre inconnu ; chemin critique prioritaire. |
| `test/guardrails.test.ts` | Classification autonome / interdit / approbation sur ~35 commandes réelles (y compris composées) ; fichiers de secrets, gouvernance, CI ; scanner de secrets à haute précision ; redaction. |
| `test/discovery.test.ts` | Découverte sur **5 projets de démonstration** : web (Next.js, Prisma, Stripe → risque critique), API (FastAPI, uv, auth → high), data (dbt, Airflow), mobile (Flutter, Firebase), bibliothèque TS (low). Commandes réelles détectées. **Sélection de skills différente par contexte.** |
| `test/install.test.ts` | `init` sans toucher au code ; recommandation « economy + paiements » ; skills projet générées (stripe, postgres) ; runtime vendored autonome ; **fusion non destructive** (settings, hooks et CLAUDE.md utilisateur préservés, sauvegardes) ; idempotence ; skill modifiée localement préservée à l'upgrade ; dry-run sans écriture ; Agent Teams activées ; doctor ; désinstallation propre. |
| `test/lifecycle.test.ts` | Scénario de bout en bout sur l'API : critères obligatoires ; dépendances et cycles ; route sensible (threat model, revue sécurité) ; plan ; **hooks** (délégation tracée, lien agent ↔ tâche, interdiction d'éditer le fichier d'une autre tâche, rapport obligatoire sans boucle) ; **refus de `done` sans gates** (y compris tâche non routée) ; détection d'un secret ; garde-fous ; échecs → nouvelle stratégie → **ESCALATE_TO_OPUS** ; checkpoint avec instantané ; **interruption rate-limit puis reprise** sans historique ; checkpoint auto PreCompact ; rappel Stop unique ; **rollback non destructif** ; rapport d'observabilité sans secret ; promotion des leçons seulement après répétition ; aucune adaptation sous le seuil ; INDEX compact. |
| `test/adaptation.test.ts` | Réduction du parallélisme après conflits ; revue relevée et Opus avancé pour un type fragile ; skills dormantes ; aucun ajustement sous le seuil ; gates adaptatives (docs, recherche, migration avec données personnelles). |

## Preuves en conditions réelles (Claude Code 2.1.284, 2026-10-02)

Sur une copie du projet de démo `web-shop` initialisée avec `ceng init --yes`, avec `claude -p --model haiku` :

1. **SessionStart** : Claude cite le contexte injecté — « [ceng] Framework d'ingénierie actif (session startup). Mémoire projet : .ceng/brain/INDEX.md… ».
2. **Skills et agents** : Claude liste `ceng-orchestrate`, `ceng-skill-forge`, `stripe-engineering` (générée) et les 11 agents `ceng-*`.
3. **Routage** : `route T-0001` sur « Endpoint webhook Stripe idempotent » → `ceng-engineer · sonnet · effort high · revue critical`.
4. **Garde-fou** : `cat .env` refusé par le hook (`guard.verdict … rule: read-secrets` dans le journal).
5. **Délégation tracée** : délégation à `ceng-scout` (Haiku) journalisée avec modèle et tâche, `SubagentStart` relie `agent_id` → `T-0001`, `SubagentStop` constate `hasReport: true`. Coût total des trois essais : environ 0,25 $.

## Ce qui n'est pas testé automatiquement

- Le comportement d'un orchestrateur Opus sur un projet long et réel : il dépend du modèle. Le framework en
  contraint et en observe le comportement (routes, gates, journal) sans pouvoir le simuler entièrement.
- Le spawn effectif d'Agent Teams : fonction expérimentale et interactive. Le planner, la charte et le hook
  `TaskCompleted` sont testés ; le lancement des teammates relève de Claude Code.
