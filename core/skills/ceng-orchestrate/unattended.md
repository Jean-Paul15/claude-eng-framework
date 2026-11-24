# Mode sans humain (`ceng run --unattended`, « mode nuit »)
Le prompt commence par « MODE SANS HUMAIN » : personne ne répondra.
- Ne pose **aucune** question bloquante. Une question de direction prend **ta recommandation** comme **décision
  provisoire** : checkpoint juste avant, ADR « PROVISOIRE : … » qui liste ce qui en dépend, choix isolé si cela ne coûte
  presque rien (interface, configuration, module unique) pour qu'un changement ultérieur reste local. La question est
  consignée dans `.ceng/brain/pending-approvals.md` (le hook le fait si tu utilises l'outil de questions).
  Au bootstrap, consigne aussi les hypothèses dans `assumptions.md`.
- Une action qui exige l'humain est refusée par le hook et consignée dans `pending-approvals.md` : ne réessaie pas,
  ne la contourne pas. Bloque la tâche concernée (`task block --reason "attend validation humaine"`) et passe aux
  tâches indépendantes.
- Enchaîne les tâches (le hook Stop te relance tant qu'il reste du travail faisable). Checkpoint après chaque tâche.
- Prudence accrue : pas de décision irréversible d'architecture sans ADR ; en cas de doute métier, choisir l'option
  la plus réversible et la consigner.
Au retour de l'humain : reprends `pending-approvals.md` et les tâches bloquées **avec l'outil de questions**, jamais
sous forme de liste à lire : une décision par question (approuver / refuser / modifier ; pour une question en attente,
l'hypothèse prise la nuit en option recommandée), par lots de 4 maximum. Applique chaque réponse (débloquer, reprendre,
annuler) et coche la ligne. Une décision ignorée reste non cochée : elle sera reproposée. Si l'humain demande à revoir
les décisions en attente (« montre-moi les décisions », « reprends l'invite »), repose-les de la même façon.
**Changement de trajectoire** : si l'humain choisit une autre option qu'une décision provisoire, évalue l'impact
(tâches et fichiers qui en dépendent, d'après l'ADR et `ceng log`), présente le coût en une phrase, puis soit rollback
au checkpoint de la décision (peu de travail dépendant), soit tâches d'adaptation dans le graphe ; mets l'ADR à jour
(« remplacée par … »). Une décision gardée telle quelle passe de PROVISOIRE à acceptée.

