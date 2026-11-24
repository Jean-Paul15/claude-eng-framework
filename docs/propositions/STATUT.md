# État d'application des propositions

Les quatre documents de ce dossier (`audit-fable.md`, `nouvelles-fonctionnalites.md`, `memoire-et-production.md`,
`securite-et-conformite.md`) ont été appliqués, sauf ce qui est listé ci-dessous avec sa raison. Chaque fonctionnalité appliquée
a ses tests (`npm test`).

## Appliqué

| Fiche | Où |
|---|---|
| P-01 gates sur le diff de la tâche | `src/app/gates.ts` (`taskBase`), `Attempt.baseCommit` |
| P-02 `SubagentHandback` | `agent-handback` dans `src/hooks/handlers.ts` |
| P-03 agents et skills créatifs toujours installés | `src/generation/catalog.ts` |
| P-04 contradictions de texte (10 points) | `core/agents/*`, `core/skills/*` |
| P-05 gate `visual` prouvée par des captures | `ceng gate record … visual pass`, `.ceng/shots/<tâche>/` |
| P-06 brief de reprise et consignes de compaction | `src/brain/brief.ts`, hook `pre-compact` |
| P-07 décisions pertinentes dans `ceng brief` | `src/app/decisions.ts` |
| P-08 reprise du même sous-agent (`SendMessage`) | `delegation.md`, `SKILL.md` |
| P-09 contexte injecté au sous-agent | hook `subagent-start` |
| P-10 `route` et bypass, UI sans direction créative | `src/cli/commands/work.ts`, `src/domain/routing.ts` |
| P-11 re-découverte quand la pile change | `stackFingerprint`, `Manifest.stackBuild` |
| P-12 contrôle des migrations SQL | `src/domain/code-check.ts` (`rls-missing`, `fk-no-index`, `destructive-migration`) |
| P-13 `--spec` sur les tâches, exigences couvertes | `task add --spec`, contrôle `spec` de `ceng ready` |
| P-14 skill d'orchestration allégée | `unattended.md`, garde-fou de taille |
| P-15 un seul hook après écriture | `after-edit` |
| D-5 jetons réels des sous-agents | `src/app/usage.ts` (lu dans la transcription, format vérifié sur un fichier réel), affiché par `ceng report` |
| D-1, D-2, D-6 | gate `unit` obligatoire pour feature/bug/refactor/security ; auditeur sur Sonnet ; chercheur sans CLAUDE.md |
| N-01 contrôle continu des tests | `ceng config tests-watch on` (sur option) |
| N-02 contrats gelés | `ceng contract` |
| N-03 tableau de bord | `ceng report --html` |
| N-04 clôture d'incrément | `ceng increment close` |
| N-05 pré-contrôle des magasins | `ceng store check` |
| N-06 règles de contrôle du projet | `ceng rule` |
| N-07 lecture du cahier des charges en contexte séparé | skill `ceng-spec-intake` |
| N-09 frein de limite d'usage et reprise automatique | `ceng config throttle`, `ceng config auto-resume`, `ceng run --resume-after-limit` |
| M-01 à M-05 mémoire des fonctionnalités | `ceng feature`, rappel à chaque demande, `task add --extends/--feature/--new`, `ceng similar`, `answers.md`, `ceng decision supersede/reject` |
| S-01, G-7 prêt pour la production | `ceng ready` |
| S-02 sécurité de la base | gate `db-security` |
| S-03 références de performance | gate `performance`, `ceng perf` |
| S-04 registre des coûts | `ceng cost` |
| S-05 vérification après déploiement | `ceng verify` |
| S-06 dépendances | `ceng dep check`, gate `dependencies`, skill `dependencies` |
| S-07 boîte de décisions | `ceng inbox` |
| G-1 à G-6 conformité et sécurité | skill `compliance-by-design` + `reference.sql`, `ceng compliance` (base minimale : `compliance add X-01` pour une nouvelle loi ou exigence, veille légale annuelle), `ceng data-map`, gates `privacy` et `abuse-tests` |

Demandes de l'humain ajoutées en cours de route : conseiller (`ceng advisor`, `--advisor` au lancement), alerte de contexte chargé
(`contextGuard`), vérification et choix des dépendances.

## Non appliqué, et pourquoi

| Fiche | Raison |
|---|---|
| N-08 état injecté à l'ouverture de la skill | le hook de démarrage injecte déjà le même brief : aucun aller-retour n'est économisé |
| N-10 avertissements groupés (`PostToolBatch`) | dépend d'un comportement non vérifié ; P-15 a déjà retiré un processus par écriture |
| P-16 (rattachement agent → tâche en parallèle), partie « échange » | l'ordre réel des événements n'est pas documenté : à mesurer sur un vrai lot parallèle. La partie vérifiable (reprise d'un agent) est faite |
| D-3 mémoire des sous-agents | activer `memory` rend l'écriture à un relecteur censé être en lecture seule ; à décider avec un essai |
| D-4 worktrees : intégration | demande un essai réel (`isolation: "worktree"` puis `gate run`) |
| S-07 acceptation automatique après 7 jours | demande de savoir si l'humain a vu la boîte : décision à poser |

## À vérifier par un essai réel (non testable ici)

- `reference.sql` (conformité) n'a pas été exécuté : à tester sur Supabase local avant usage.
- La reprise automatique lance un processus détaché depuis un hook : sa survie à la fermeture de l'application sous Windows n'est pas
  prouvée.
- Le conseiller (`--advisor`) est une fonction expérimentale de Claude Code : `/advisor` dans la session donne l'état réel.
- Le test d'intégration graphify (`codegraph.test`) peut dépasser son délai quand la machine est chargée ; il passe seul.
