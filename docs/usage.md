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
