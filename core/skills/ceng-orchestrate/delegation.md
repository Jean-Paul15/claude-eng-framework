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
Décisions en vigueur : <chemin de VISION.md / DECISIONS.md du chantier, à lire AVANT de commencer> (si chantier)
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

## Grand chantier : plusieurs agents vers une même finalité
Pour un chantier large (refonte, audit global, nouvelle offre) où plusieurs agents travaillent longtemps vers un même
but. Ce qu'on sait (Anthropic, *multi-agent research system* ; Cognition, *Don't build multi-agents*) : le parallèle
paie pour CHERCHER et LIRE (chef Opus + agents Sonnet nettement meilleurs qu'un agent seul), coûte environ 15 fois plus
de tokens qu'une conversation, et casse le code quand plusieurs agents écrivent en même temps avec des choix implicites
différents. D'où :
1. **Phases.** Recherche et audit en parallèle, en lecture seule ; synthèse par l'orchestrateur ; conception
   (direction créative ou principal) ; mise en œuvre par étapes ; relecture croisée après chaque étape.
2. **Un seul agent qui écrit à la fois** sur du code qui se touche. Deux au plus, seulement si leurs fichiers sont
   disjoints ET les contrats figés (§ Parallélisme). Au plus 3 agents en même temps par défaut, quelle que soit la phase.
3. **En étoile, jamais en réseau.** Les agents ne se parlent pas : tout passe par l'orchestrateur et une mémoire commune
   du chantier, `.ceng/brain/chantiers/<nom>/` :
   - `VISION.md` : finalité, principes, décisions validées (tenue par l'orchestrateur, lue par tout agent avant de
     travailler) ;
   - `DECISIONS.md` : chaque proposition et son sort (validée, adaptée, écartée) avec la raison ; les décisions
     structurantes passent aussi en ADR (`ceng decision add`) ;
   - `recherche/`, `audit/` : un rapport court par agent (l'orchestrateur lit les rapports, pas leurs explorations).
4. **Circuit d'une proposition.** L'agent propose dans son rapport (ce que ça améliore, ce que ça touche ailleurs, les
   hypothèses implicites qu'il a prises) → l'orchestrateur la confronte aux autres et à VISION.md → brief groupé à
   l'humain (une ligne par proposition, son impact) → décision → VISION.md et DECISIONS.md mis à jour → chaque brief
   suivant y renvoie (« Décisions en vigueur »), si bien que tous les agents travaillent sur la même base.
5. **Validation par défaut.** Si l'humain l'a dit (sinon, demander une fois au lancement du chantier), toute
   proposition qui sert la finalité est acceptée par défaut : le brief informe, on ne bloque que sur un vrai choix
   (directions incompatibles, coût ou risque fort, sujet sensible, action à approbation humaine du § 6).
6. **Un agent ne change jamais une décision validée** de lui-même : il propose, l'orchestrateur tranche.
7. **Contexte complet, question précise.** Chaque agent reçoit le brief du chantier, VISION.md, DECISIONS.md, son
   périmètre et un critère de réussite ; un agent qui ne peut pas poser de question doit pouvoir travailler sans.
8. **Effectifs et modèles.** Orchestrateur et conception sur le modèle le plus fort ; recherche, audit, exécution et
   relecture sur le modèle par défaut (Sonnet) ; exploration volumineuse sur Haiku (`ceng-scout`). Les effectifs du
   chantier sont écrits dans VISION.md et validés par l'humain avant de lancer.

## Quand NE PAS déléguer
Tâche triviale, contexte déjà chargé, correction d'une ligne : fais-le. Une délégation coûte un prompt
système + CLAUDE.md + brief + le résumé de retour.
