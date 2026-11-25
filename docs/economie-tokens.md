# Économie de jetons : ce que ceng fait déjà, et les trois plugins du moment

Étude du 25 novembre 2026 d'un guide qui présente trois plugins gratuits (Ponytail, Graphify, RTK). Les chiffres viennent des dépôts officiels, lus ce jour-là ; ils changent vite, le dépôt fait foi.

## Où part la consommation

| Poste | Réduit par | Dans ceng |
|---|---|---|
| Fichiers relus à chaque question | Graphify | **déjà intégré** : carte du code construite et tenue à jour par les hooks (`ceng graph`) |
| Code écrit en trop | Ponytail | règles déjà dans les standards (pas de sur-ingénierie, pas de duplication, `ceng similar`) |
| Sortie des commandes du terminal | RTK | non intégré : option laissée à l'utilisateur |

## Graphify : intégré, avec un ajout

ceng construisait la carte avec `graphify extract --code-only --no-cluster` (analyse locale, zéro appel IA), puis la mettait à jour en arrière-plan. Il manquait l'étape que le guide recommande : `graphify cluster-only . --no-label`, qui regroupe le code en communautés et produit `GRAPH_REPORT.md` (architecture, nœuds les plus reliés) et `graph.html` (carte à ouvrir dans le navigateur). Elle est locale, sans IA, et prend quelques secondes (essai sur ce dépôt : 5 s, 2 284 nœuds, 184 communautés).

**Ajouté** : `ceng graph build` et le rafraîchissement en arrière-plan lancent désormais ce regroupement après l'extraction. Si le regroupement échoue, le graphe reste valable.

À savoir : la version gratuite lit le code, pas les documents ni les pages HTML ; un projet surtout en HTML donne une carte presque vide. `/graphify .` ajoute les documents mais consomme des jetons.

## Ponytail : pas intégré, doublon partiel

Ponytail est un skill (« écris la plus petite modification qui résout la tâche ») avec trois hooks (`SessionStart`, `SubagentStart`, `UserPromptSubmit`) et un bandeau de coût. Licence MIT.

- Les chiffres annoncés (45 % de jetons, 53 % de code, 26 % de coût en moins) viennent du banc d'essai de l'auteur : 39 tâches, 5 essais chacune, Opus 5.5. Le « 45 % » porte sur les **jetons de sortie** seulement, pas sur tous les jetons. Le banc d'essai désactive Bash pour tous les bras et ne teste le code par exécution que sur 18 tâches sur 39 ; les juges sont des modèles. C'est publié et reproductible, mais ce n'est pas le cas d'usage de ceng.
- Ses hooks ajoutent du texte à chaque message de l'utilisateur (taille non mesurée par la lecture des pages).
- Son niveau `ultra` remet la demande en question avant de construire : cela s'oppose au travail autonome de ceng (bypass, mode nuit, décisions provisoires). Son habitude de finir chaque réponse par ce qui a été laissé de côté peut doubler le bloc de sortie imposé aux agents ceng.

**Conseil** : ne pas l'installer pour ceng, dont les standards disent déjà la même chose. Si tu l'as déjà, `/ponytail lite`. `ceng doctor` le signale.

## RTK : option, à tes risques sur un point précis

RTK réécrit les commandes Bash (`cargo test` devient `rtk cargo test`) pour résumer leur sortie. Il passe par un hook `PreToolUse` posé par `rtk init -g` dans `~/.claude/settings.json`. Licence : la CLI est en Apache-2.0, le moteur complet et le démon en BUSL-1.1.

- Le chiffre « jusqu'à 90 % de texte en moins » est un ratio d'octets (octets divisés par 4, sans vrai décompte de jetons) sur la sortie des commandes, pas sur la facture. La doc de RTK le dit elle-même.
- Télémétrie : désactivée par défaut, une requête par jour si tu l'actives (aucun contenu de code, de commande ou de chemin).
- **Point à vérifier avant de l'adopter avec ceng** : ceng protège aussi par un hook `PreToolUse` sur Bash (suppressions, `git push`, déploiements, règles réservées à l'humain). Les deux hooks s'exécutent sur la même commande ; la doc de RTK ne dit rien sur la cohabitation avec d'autres hooks. L'effet attendu est que le garde ceng juge la commande d'origine, mais cela n'a pas été essayé. En cas de refus inattendu ou de sortie étrange : `RTK_DISABLED=1`. `ceng doctor` signale sa présence.
- Il ne résume rien de ce que ceng lit par ses propres moyens (les contrôles qualité lancés par ceng ne passent pas par Bash de Claude).

**Conseil** : utile si tes sessions lancent beaucoup de tests ou de `git` verbeux. À essayer sur un projet jetable d'abord, en vérifiant qu'une suppression ou un `git push` demandent toujours leur approbation.

## À ne pas faire

- Ne jamais coller dans Claude Code le prompt « installe pour moi » du guide : il demande d'installer des programmes et de modifier `settings.json` sans que tu les aies relus.
- Ne pas remplir le formulaire de la fin du guide : c'est la publicité d'une communauté payante, sans lien avec les outils.
