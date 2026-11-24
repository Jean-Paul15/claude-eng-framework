# Guide d'usage détaillé

Contenu déplacé depuis le README : démarrage pas à pas, usage quotidien, mode sans humain, équipe de sessions.


## 1. Installer (une seule fois par machine)

Prérequis : [Node.js](https://nodejs.org) 22 ou plus récent, git et [Claude Code](https://code.claude.com/docs/en/setup)
(terminal, Claude Desktop onglet Code, ou web).

```bash
# Apprend à Claude à installer et gérer le framework, dans n'importe quel projet
npx skills add Jean-Paul15/claude-eng-framework -s ceng-setup -g -a claude-code -y

# Facultatif : rend la commande `ceng` disponible partout
npm install -g github:Jean-Paul15/claude-eng-framework
```

## 2. Démarrer un projet (Claude Desktop ou terminal)

1. **Ouvre le dossier du projet** (vide ou existant) dans Claude Desktop, onglet **Code**, ou lance `claude`
   dedans. Accepte la confiance du dossier si elle t'est demandée.
2. **Dis à Claude :** « Installe le framework claude-eng-framework dans ce projet. »
   Il te pose quelques questions en un seul message (niveau de risque, autonomie, budget, parallélisme, objectif,
   graphify), installe le framework, te montre ses recommandations et vérifie que tout fonctionne.
3. **Lance l'orchestrateur avec ton projet :**
   ```text
   /ceng-orchestrate Je veux une appli de réservation pour un salon de coiffure, avec paiement en ligne.
   ```
   Il pose les questions de cadrage une fois (utilisateurs, périmètre, contraintes, critères de succès), conçoit
   l'architecture, découpe le travail en tâches et commence.
   **Tu as un cahier des charges ?** Donne-le tel quel (et, si tu en as, des fichiers de code de référence à reprendre) :
   ```text
   /ceng-orchestrate Voici le cahier des charges : <colle-le ou donne le chemin>. Références : src/legacy/cart.ts
   ```
   Opus le lit, pose au plus une série de questions si un point à fort impact est flou, te fait valider le plan, puis
   livre par incréments : migrations SQL, contrats d'API et code plutôt que documents, diagrammes seulement quand ils
   portent le flux, tests de la logique en TDD, parcours capturés en images et relus sur mobile, tablette et desktop.
4. **Tu suis et tu valides.** Il ne revient vers toi que pour les décisions qui te reviennent et les actions sensibles
   (déploiement, données de production, licences). Si tu fermes la session, la suivante reprend là où il s'était arrêté.

Sans passer par Claude, l'équivalent en terminal, depuis le dossier du projet :

```bash
npx github:Jean-Paul15/claude-eng-framework init    # ou `ceng init` si installé globalement
ceng run                                             # ouvre Claude Code en mode orchestrateur
```

## 3. Au quotidien

| Tu veux… | Tu fais… |
|---|---|
| Faire avancer le projet en autonomie | `/ceng-orchestrate` (avec une consigne si tu veux) |
| Le laisser travailler sans toi (la nuit) | `ceng run --unattended` dans un terminal (voir ci-dessous) |
| Savoir où en est le projet | demander à Claude « où en est le projet ? », ou `ceng status` |
| Une petite modification ou une question | parler à Claude normalement : le framework reste actif en arrière-plan |
| Comprendre pourquoi une décision a été prise | `ceng report`, `ceng log --task T-0004`, `ceng route T-0004` |
| Lui donner carte blanche, sans aucune validation | `ceng bypass on` (toi, dans un terminal), puis nouvelle session — voir ci-dessous |
| Savoir si quelque chose existe déjà avant d'en créer un autre | `ceng similar historique des commandes` |
| Vérifier l'installation | `ceng doctor` |
| Mettre à jour le framework dans le projet | `npx -y github:Jean-Paul15/claude-eng-framework upgrade` |
| Reprendre sur une autre machine | cloner le dépôt et ouvrir Claude : rien à installer (le runtime est dans `.ceng/runtime/`) |

Dans un projet, `ceng` peut toujours être remplacé par `node .ceng/runtime/cli.js`.

## 4. Travailler la nuit, sans toi

```bash
ceng run --unattended                                   # jusqu'à 10 h, 30 relances
ceng run --unattended --max-hours 8 --max-budget-usd 20 # avec limites explicites
```

- **Rien n'attend jamais une réponse.** Une action qui demanderait ton accord (déploiement, push forcé…) est
  refusée proprement et notée dans `.ceng/brain/pending-approvals.md`. Ses questions y sont aussi, avec l'hypothèse
  provisoire retenue. Claude passe aux tâches indépendantes.
- **Pas d'arrêt en cours de route.** Il enchaîne les tâches tant qu'il en reste de faisables et qu'il progresse. Il
  s'arrête quand tout est fait ou bloqué, ou quand il ne progresse plus.
- **Les interruptions sont gérées.** Après une limite d'usage ou une surcharge, il attend (15 min par défaut) puis
  reprend depuis la mémoire du projet.
- **Au réveil**, ouvre Claude : il te présente via l'invite de questions ce qui attend ta validation, puis applique
  tes réponses. `ceng report` détaille la nuit.

**Sans même lancer le mode nuit**, une session normale bascule toute seule. Chaque validation (approuver une action,
choisir une direction) passe par l'invite de questions de Claude Code, qui peut expirer : réglage utilisateur
`askUserQuestionTimeout` à `10m`, le maximum de Claude Code. Le reste du fonctionnement :
- **Projet sans utilisateurs réels** : `ceng config stage prototype` lève les validations pour ce qui est récupérable (migrations,
  déploiements, suppressions avec instantané, push, fichiers de garde-fous) ; secrets, suppression hors du dépôt, push forcé sur
  une branche protégée partagée, publication et infrastructure restent à valider. `ceng config stage production` rétablit tout.
- **Tu réponds** : seule ta réponse réelle autorise l'action — 30 min pour cette même action (relances après une
  erreur comprises), une seule fois pour une opération destructive.
- **L'invite expire sans réponse** : le projet passe en mode sans humain. Les demandes sont consignées, les questions
  de direction prennent la recommandation de Claude comme décision provisoire, et le travail continue.
- **Tu réécris** : les invites reviennent, et tu peux changer de trajectoire. Chaque décision provisoire est tracée
  (ADR), précédée d'un point de restauration, et gardée réversible.

Les décisions sont triées avant de te déranger, selon que Claude est sûr ou non, et selon que changer d'avis
coûterait peu ou beaucoup :
- **Évident** (bonne pratique établie dans ce contexte) : il décide et te tient au courant.
- **Incertain mais facile à changer** : il te demande. Si tu es absent, sa recommandation devient une décision
  provisoire et il continue.
- **Incertain et coûteux à changer** : il te demande. Si tu es absent, il ne construit rien sur une supposition :
  seules les tâches qui en dépendent attendent ta réponse, tout le reste avance.

Désactivable avec `ceng init --presence off`, qui rétablit les boîtes de permission natives.

Lance le mode nuit dans un terminal plutôt que dans une session de Claude Desktop. Une session interactive s'arrête
sur la moindre invite de permission ; le mode `--unattended` est conçu pour ne jamais en afficher.

## Bypass total : Claude peut tout faire

```bash
ceng bypass on      # toi seul : Claude ne peut pas se l'accorder
ceng bypass off     # retour aux garde-fous
```

Plus aucune validation ni refus : suppressions, push (forcé compris), déploiements, migrations, infrastructure, création et
lecture des fichiers `.env`, fichiers de garde-fous. Claude Code passe en `bypassPermissions` (nouvelle session après
l'activation). Ce qui reste, parce que ça ne freine rien : tout est journalisé, un instantané est pris automatiquement avant
une suppression ou un reset (`ceng rollback`), les secrets sont utilisés sans être affichés quand c'est possible et ne sont
jamais recopiés dans un rapport, un log ou un commit, et deux agents parallèles ne s'écrasent pas le même fichier.

## Livrer sans rien oublier ni rien laisser passer

Ce que Claude consulte et vérifie tout seul, et les commandes qui le portent (toutes en `ceng <commande>`) :

| Besoin | Commande | Ce que ça garantit |
|---|---|---|
| Ne pas refaire ce qui existe | `feature add/list/reject`, `similar`, `task add --extends F-xxx` | à chaque demande, Claude voit ce qui est déjà livré, en cours ou écarté ; une tâche proche d'une existante est refusée sans justification |
| Ne pas reposer une question | `decision supersede/reject`, `.ceng/brain/answers.md` | les réponses données et les décisions mortes sont retrouvées |
| Savoir ce qui t'attend | `inbox`, `report --html` | décisions bloquantes d'abord, puis à confirmer ; page unique lisible sur téléphone |
| Livrer en incréments | `increment close <groupe>` | tout est terminé, vu en captures, testé |
| Geler un contrat entre agents | `contract freeze/bump` | un sous-agent ne modifie pas l'API ou le schéma |
| Prêt pour la production | `ready` | variables d'environnement documentées, secrets, migrations, CI, santé, suivi d'erreurs, conformité, coûts |
| Conformité (RGPD et équivalents) | `compliance status/set`, `data-map` | politiques versionnées et ré-acceptation, consentements, conservation, audit, anomalies, incidents |
| Dépendances | `dep check [noms]` | licence, maintenance, vulnérabilités, usage, nom usurpé ; gate `dependencies` |
| Performance et coûts | `perf show`, `cost add`, `cost --users N` | une dégradation de plus de 10 % bloque ; la facture mensuelle est connue |
| Après un déploiement | `verify` | le déploiement est vérifié, pas supposé |
| App iOS | `store check` | motifs de rejet Apple détectables avant la soumission |
| Règles du projet | `rule add --pattern … --message …` | une erreur relevée ne se réécrit plus |
| Conseiller | `advisor fable|opus|sonnet|off` | un modèle plus fort consulté aux décisions clés (`--advisor`, fonction expérimentale de Claude Code) |
| Limites du compte | `config throttle`, `config auto-resume on`, `config tests-watch on` | routage économe jusqu'à la réinitialisation, reprise automatique, tests en arrière-plan |

L'état d'application des propositions d'amélioration est dans [docs/propositions/STATUT.md](propositions/STATUT.md).

## 5. Plusieurs sessions en équipe, sans humain devant l'écran

Quand plusieurs sessions Claude Code travaillent en parallèle (une copie de travail chacune), deux choses évitent que tout s'arrête
ou que tout passe sans contrôle :

```bash
ceng team on                       # action humaine : équipe autonome
ceng relay watch --reader coordination --interval 5   # coordination : écoute, branchée sur l'outil Monitor
ceng relay emit --kind opus-ready --session 4 --ref docs/integration/DOSSIER_4.md   # une session signale un point d'arrêt
```

- **Équipe autonome (`ceng team on`)** : au lieu de boîtes de permission qui bloquent, le framework tranche selon une liste de
  sécurité fermée et journalisée. Lecture, recherche, coordination entre sessions, outils locaux et commandes classées autonomes
  passent ; ce qui agit hors de la machine (base de production, déploiement, e-mail, paiement, secrets) ou change les permissions
  est refusé proprement et consigné dans `pending-approvals.md`, sans jamais attendre. Ce n'est pas le contournement total des
  permissions de Claude Code : rien n'est désactivé, les garde-fous restent actifs et deviennent explicites. Activer ou couper ce
  mode est une action humaine. `--allow` / `--defer` ajustent la liste pour un outil MCP précis.
- **Relais (`ceng relay`)** : une session qui atteint un point d'arrêt émet un événement (dans le dépôt principal, quel que soit
  son worktree) ; la session de coordination l'écoute avec `relay watch`, qui n'imprime qu'une ligne par événement. Branché sur Monitor,

## Mettre à jour le framework dans tes projets
Rien à faire projet par projet : au démarrage d'une session, un projet dont la copie du framework est plus ancienne que
celle de la machine se met à jour tout seul en arrière-plan (fichiers modifiés par toi préservés ; nouvelles skills actives
à la session suivante). Pour tout mettre à jour d'un coup : `ceng upgrade --all`. Désactiver pour un projet :
`"autoUpgrade": false` dans `.ceng/config.json`. Un nouveau projet prend toujours la dernière version à `ceng init`.
