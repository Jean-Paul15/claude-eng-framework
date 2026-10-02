# Délégation, parallélisme, Agent Teams

## Brief de délégation (outil Agent) — modèle
Le worker ne voit **pas** ta conversation. Le brief doit suffire, et rien de plus.

```
Tâche T-0007 — <titre>                       ← l'ID T-xxxx est obligatoire (traçabilité par les hooks)
Objectif : <résultat attendu, 1-2 phrases>
Contexte minimal : <ce que le worker doit savoir et qu'il ne peut pas trouver seul ; chemins utiles>
Périmètre : fichiers autorisés <globs> · interdits <…>
Critères d'acceptation : <liste vérifiable>
Stratégie de test : <route.testStrategy.flow> [types]
Contraintes : <contrats figés, conventions, décisions ADR applicables>
Livrable : code + tests + .ceng/brain/reports/T-0007.md + bloc CENG_REPORT
```
Paramètres de l'outil Agent : `subagent_type` = route.implementer.agent, `model` = route.implementer.model.
**Ne passe pas `name`** pour une délégation ordinaire quand les Agent Teams sont activées (un subagent nommé
devient un teammate). N'envoie pas le contenu des skills : le worker les charge lui-même.

## Budget de contexte
- Ne donne pas au worker : l'historique, toutes les recherches, tout le repo. Donne des pointeurs.
- Sortie volumineuse à analyser (logs, tests, grep large) → `ceng-scout` (Haiku) qui renvoie un résumé.

## Parallélisme (`ceng plan`)
Le planner ne met dans un même lot que des tâches **sans recouvrement de fichiers**. Tu dois :
1. Déclarer des `--files` précis à la création (sinon : séquentiel ou worktree isolé).
2. Pour `parallel-subagents` : lancer les délégations du lot **dans un même message** avec
   `run_in_background: true` ; `isolation: "worktree"` si le plan l'indique.
3. Figer d'abord tout contrat partagé (`--interfaces`) : types, schéma d'API, format — sinon les workers divergent.
4. À la fin du lot : `ceng conflicts` → intégration → tests globaux → revue ciblée → gates.
Si les conflits se répètent, `ceng adapt` réduit le parallélisme : revois la découpe.

## Agent Teams (seulement si `ceng plan` propose `agent-team`)
Critères vérifiés par le planner : ≥ 3 tâches indépendantes en fichiers, contrat partagé nécessitant une
coordination directe, session interactive, teams activées, budget ≠ economy.
1. `ceng plan --charter "mission"` → charte dans `.ceng/brain/teams/` (mission, membres, fichiers exclusifs,
   limites, protocole de communication, validation).
2. Spawn des teammates (Sonnet par défaut, type = agent de la route), un prompt par teammate : son ID de tâche,
   le chemin de la charte, son périmètre. 3 à 5 teammates maximum.
3. Messages entre agents : seulement s'ils changent le travail d'un autre (décision, blocage, contrat, risque,
   résultat de test). Pas de compte rendu de progression.
4. Attends la fin ; ne code pas à leur place. Puis : conflits → intégration → revue ciblée → gates. Arrête les teammates.
Limites Claude Code : pas de reprise des teammates après `/resume` ; pas en mode non interactif. Le Brain
(charte, rapports, tâches) permet de reprendre quand même.

## Quand NE PAS déléguer
Tâche triviale, contexte déjà chargé, correction d'une ligne : fais-le. Une délégation coûte un prompt
système + CLAUDE.md + brief + le résumé de retour.
