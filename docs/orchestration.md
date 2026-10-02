# Orchestration, routage des modèles, subagents, Agent Teams

Principe : **la plus petite quantité d'intelligence, de contexte, d'agents et de tokens qui produit la qualité
requise.** Quand le risque augmente, la qualité passe avant l'économie.

## Rôles

- **Modèle d'entrée** : la session avec laquelle l'humain parle. `ceng run` le lance sur le modèle recommandé par la
  politique : Opus si le projet est à risque ou ambigu, Sonnet sinon. Une fois la spécification reçue, il devient
  l'orchestrateur.
- **Orchestrateur** : comprend l'objectif, construit le graphe de tâches, évalue chaque tâche, suit la route, délègue,
  arbitre, vérifie les gates et décide quand c'est terminé. En mode Opus, il ne code pas par défaut. Il ne lit pas le
  code des workers ligne à ligne : les rapports, les tests et les gates sont ses garanties.
- **Workers** : prennent seuls les décisions locales. Ils ne remontent que ce qui compte : décision architecturale,
  conflit, risque, blocage, échec répété.

## Évaluation → route (`ceng route <tâche>`)

L'orchestrateur note la tâche sur 1-5 (complexité, risque, ambiguïté, nouveauté, impact architectural), puis indique
la taille de contexte, les domaines, les fichiers, les contrats et les critères d'acceptation. La politique
(`src/domain/routing.ts`) en déduit :

| Sortie | Règle principale |
|---|---|
| `executor` | `direct` si la tâche est triviale (déléguer coûterait plus que faire) ou si elle est courte et que le modèle d'orchestration est le même ; `subagent` si le contexte est volumineux (isolation) ou si l'orchestrateur est Opus |
| `implementer.model` | **Haiku** : tâches mécaniques à faible risque. **Sonnet** : le défaut pour l'implémentation définie. **Opus** : après escalade, ou complexité 5 en domaine critique |
| `implementer.agent` | builder (effort medium) · engineer (complexité ou risque ≥ 4, bug ≥ 3) · tester · researcher · frontend-executor (UI avec direction créative) · creative-director (design) |
| phase `design` (Opus) | ambiguïté ≥ 4, impact ≥ 4, nouveauté ≥ 4 et complexité ≥ 3, ou domaine critique non trivial. **Opus conçoit, Sonnet implémente.** |
| `effort` | max(complexité, ambiguïté) → low/medium/high/xhigh ; −1 en economy et +1 en quality ; jamais sous `high` en domaine critique |
| `reviewLevel` | none · targeted · thorough · critical (domaine critique) |
| `testStrategy` | bug : régression d'abord · critique : spécification → stratégie → implémentation · UI : prototype → validation visuelle · refactor : caractérisation |
| `gates` | voir [quality.md](quality.md) |
| `escalate` | après N échecs (2, ou 1 en mode quality) → `ceng-principal` (Opus) ; après un échec d'Opus → humain |
| `humanApproval` | infra ou migration critique, risque 5 critique hors autonomie high, licence, autonomie supervisée avec risque ≥ 4 |
| `costIndex` | coût relatif (modèle × effort × contexte + surcoût de lancement) pour comparer les options |
| `reasons` | l'explication lisible de chaque choix |

En mode `economy`, les seuils qui déclenchent Opus montent d'un cran et l'effort baisse, **sauf** pour les domaines
critiques : l'économie de tokens ne justifie jamais d'ignorer un problème de sécurité, un bug critique, des tests
nécessaires ou une revue architecturale nécessaire.

## Parallélisme (`ceng plan`)

Ordre de préférence, du moins cher au plus cher : **direct → séquentiel → subagents parallèles → Agent Team.**

- Tâches triviales : faites en direct, sans agent.
- Lot parallèle : des tâches prêtes, **sans recouvrement de fichiers** (détecté sur les globs, de façon conservatrice),
  dans la limite de `maxParallel`. Il faut au moins deux tâches substantielles, sinon le parallélisme ne rapporte rien.
- Une tâche sans périmètre déclaré passe en tête de lot avec `isolation: worktree`, ou est différée.
- Chemin critique prioritaire : les tâches qui débloquent le plus d'autres tâches passent en premier.
- **Agent Team** seulement si : ≥ 3 tâches, contrat partagé (`--interfaces`) nécessitant une coordination directe,
  session interactive, teams activées et budget ≠ economy. Sinon des subagents parallèles suffisent : seuls leurs
  résumés reviennent, c'est moins cher.

Après un lot : `ceng conflicts`, puis intégration, revue ciblée et gates. Si des conflits se répètent, `ceng adapt`
réduit le parallélisme.

## Subagents

Les définitions (`core/agents/`) encodent le rôle, l'effort et les outils (pas d'outil `Agent` pour les workers :
l'orchestrateur garde la vue du graphe). Le modèle est passé à chaque invocation (`model`), ce qui permet un même
agent sur Haiku, Sonnet ou Opus selon la route.

**Brief de délégation** (skill `ceng-orchestrate/delegation.md`) : ID de tâche (obligatoire pour la traçabilité),
objectif, contexte minimal, fichiers autorisés, critères, stratégie de test, contraintes, livrable. Ne pas passer
`name` quand les teams sont activées : un subagent nommé deviendrait un teammate.

**Retour** : le worker écrit `.ceng/brain/reports/<tâche>.md` (le détail) et termine par un bloc `CENG_REPORT`
(10 à 15 lignes). Le hook `SubagentStop` le lui rappelle une fois s'il l'oublie. L'orchestrateur ne lit le rapport
complet que si une décision l'exige.

## Agent Teams

Fonction expérimentale de Claude Code (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`), activée par `--parallelism teams`.
Protocole :
1. `ceng plan --charter "mission"` écrit `.ceng/brain/teams/TEAM-xxxx.md` : mission, membres, fichiers exclusifs,
   limites, communication, validation.
2. Le lead lance 3 à 5 teammates (Sonnet par défaut), chacun avec son ID de tâche et le chemin de la charte.
3. **Budget de communication** : un message n'est envoyé que s'il change le travail d'un autre agent. Format de
   3 lignes maximum, sans compte rendu de progression.
4. Intégration par le lead, qui ne code pas à la place des teammates.

Limites de Claude Code dont le framework tient compte : pas de reprise des teammates après `/resume` (le Brain
permet de relancer à partir des rapports), pas de teams en mode `-p`, une équipe par session.

## Escalade ESCALATE_TO_OPUS

`ceng escalate <tâche> --problem … --tried … --results … --hypotheses … --decision …` crée un dossier minimal dans
`.ceng/brain/escalations/`. On délègue ensuite à `ceng-principal` (Opus) avec **uniquement** ce dossier : il tranche
ce problème-là, sans relancer l'analyse du projet. Il enregistre sa décision avec `escalate resolve`, puis le worker
reprend son travail (`SendMessage` à son ID, ou un nouveau worker avec la décision).

## Budget de contexte

- L'orchestrateur charge `INDEX.md`, puis le reste à la demande.
- Une sortie volumineuse est confiée à `ceng-scout` (Haiku), qui la résume.
- Un worker reçoit un brief, pas la conversation ; il charge lui-même les skills dont il a besoin.
- Les skills non pertinentes ne sont pas installées. Les skills dormantes sont signalées par `ceng adapt`.
