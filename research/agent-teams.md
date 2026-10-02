# Agent Teams vs subagents vs agent unique

Sources :
- https://code.claude.com/docs/en/agent-teams (doc officielle, vérifiée 2026-10-02)
- https://code.claude.com/docs/en/costs#agent-team-token-costs
- https://www.anthropic.com/engineering/multi-agent-research-system (Anthropic Engineering)

## Faits vérifiés

- Agent Teams : expérimental, activé par `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.
- Architecture : *team lead* (session principale) + *teammates* (instances Claude Code complètes,
  contexte propre) + *task list* partagée (états pending / in progress / completed, dépendances,
  verrou fichier sur la réclamation) + *mailbox* (messages directs entre agents).
- Les teammates chargent CLAUDE.md, MCP et skills du projet, **pas** l'historique du lead : le
  prompt de spawn doit contenir le contexte spécifique.
- Modèle d'un teammate : celui nommé dans le prompt de spawn → `model` de la définition
  subagent utilisée → `CLAUDE_CODE_SUBAGENT_MODEL` → modèle du lead. Effort hérité du lead.
- Hooks de qualité : `TeammateIdle`, `TaskCreated`, `TaskCompleted` (exit 2 = refuser + feedback).
- Limites : pas de reprise des teammates in-process après `/resume`, une équipe par session,
  pas d'équipes imbriquées, statut de tâche parfois en retard, interactif seulement.
- Recommandations officielles : 3–5 teammates, tâches autonomes à livrable clair
  (5–6 tâches par teammate), **éviter que deux teammates éditent le même fichier**, commencer par
  recherche/revue, Sonnet pour les teammates, arrêter les teammates terminés.
- Coût : proportionnel au nombre de teammates ; ~7× une session standard en plan mode.

## Leçons du système multi-agent d'Anthropic

- Orchestrateur-workers ; ~15× plus de tokens qu'un chat → réservé aux tâches dont la valeur
  justifie le coût.
- Mauvais candidats : tâches où tous les agents partagent le même contexte ou avec beaucoup de
  dépendances ; **le code est cité comme moins parallélisable que la recherche**.
- Chaque délégation doit préciser : objectif, format de sortie, outils/sources, frontières.
- Règles d'échelle explicites dans le prompt (1 agent pour le simple, plusieurs pour le complexe).
- Les sous-agents écrivent leurs artefacts sur le système de fichiers plutôt que de tout faire
  transiter par le lead (« jeu du téléphone »).

## Conclusions pour le framework (décisions)

1. **Ordre de préférence** : exécution directe → subagent séquentiel → subagents parallèles
   (en arrière-plan, éventuellement en worktree) → Agent Team. On ne monte d'un cran que si le gain
   attendu dépasse le coût de coordination.
2. **Critères d'une team** (tous requis) : ≥ 3 lots prêts **indépendants en fichiers**, besoin de
   coordination entre lots (contrat partagé, débat d'hypothèses, couches frontend/backend/tests),
   session interactive, teams activées, préférence budget ≠ `economy`.
   Sinon → subagents parallèles (moins chers : seuls les résumés reviennent).
3. **Prévention des conflits** : chaque tâche déclare ses fichiers (globs). Deux tâches dont les
   globs se recouvrent ne sont jamais dans le même lot parallèle. Tâches sans périmètre déclaré →
   isolement en worktree ou exécution séquentielle.
4. **Détection** : le hook `PostToolUse` journalise (agent, fichier) ; `ceng conflicts` détecte un
   fichier touché par deux agents dans la même fenêtre parallèle. L'adaptation réduit le
   parallélisme si les conflits se répètent.
5. **Charte d'équipe** obligatoire (mission, contexte, limites, fichiers autorisés, critères de
   succès, livrable, protocole de communication, validation) écrite dans le Project Brain, pour que
   la synthèse et la reprise ne dépendent pas de la mailbox (non persistante).
6. **Budget de communication** : un message n'est envoyé que s'il change le travail d'un autre agent
   (décision, blocage, conflit, changement de contrat, résultat de test, risque, escalade).
7. Délégations ordinaires sans paramètre `name` quand les teams sont activées (sinon elles deviennent
   des teammates par effet de bord — comportement documenté).
