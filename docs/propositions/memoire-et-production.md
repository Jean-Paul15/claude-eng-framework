# Mémoire des fonctionnalités et livraison toujours « production »

Troisième document de propositions, après `audit-fable.md` (corrections) et `nouvelles-fonctionnalites.md`.
Deux objectifs fixés par l'humain :

- **A. Ne rien oublier** : quand il revient et demande quelque chose, Claude regarde d'abord ce qui a déjà été
  décidé, commencé ou livré, au lieu de coder une seconde version.
- **B. Toujours livrer du solide** : le niveau « production » est vérifié par l'outil, pas par la mémoire de
  l'agent. L'humain ne tranche que ce qui a réellement besoin de lui.

Principe commun : **une règle écrite dans une skill s'oublie, un contrôle exécuté par un hook ou une commande ne
s'oublie pas**. Chaque fiche remplace donc une consigne par un mécanisme.

Mêmes règles que les deux autres documents : TypeScript, aucune dépendance, champs ajoutés optionnels, tests en
`node:test`. Coût : S = moins d'une heure d'agent, M = une à trois heures. Rien n'est implémenté.

## Vue d'ensemble

| ID | Mécanisme | Ce que ça garantit | Coût |
|---|---|---|---|
| M-01 | Registre des fonctionnalités | une liste unique de ce qui est décidé, en cours, livré ou écarté | M |
| M-02 | Rappel automatique à chaque message de l'humain | Claude voit « ça existe déjà » avant d'écrire une ligne | M |
| M-03 | Garde anti-doublon à la création d'une tâche | impossible de créer une tâche proche d'une existante sans le dire | S |
| M-04 | `ceng similar` élargi au registre, aux tâches et aux décisions | la recherche d'existant ne se limite plus au code | S |
| M-05 | Décisions remplacées ou écartées, et réponses de l'humain, conservées | une idée refusée n'est pas reproposée ; une réponse donnée n'est pas redemandée | S |
| S-01 | `ceng ready` : contrôle « prêt pour la production » | aucun incrément livré avec un trou connu | M |
| S-02 | Sécurité de la base prouvée par des tests | chaque table protégée a son test d'accès | M |
| S-03 | Budgets de performance avec référence | une régression de vitesse ou de taille bloque la tâche | M |
| S-04 | Registre des coûts de production | la facture mensuelle estimée est connue avant de livrer | M |
| S-05 | Vérification après déploiement | un déploiement cassé est détecté dans la minute | S |
| S-06 | Nouvelle dépendance justifiée | pas de bibliothèque ajoutée sans raison ni licence vérifiée | S |
| S-07 | Boîte de décisions unique (`ceng inbox`) | tout ce qui attend l'humain au même endroit, trié par impact | M |

Ordre conseillé : M-01 → M-04 → M-03 → M-02 → M-05 (la mémoire d'abord, chaque étape s'appuie sur la précédente) ;
puis S-07, S-01, S-02 ; le reste ensuite.

---

# A. Ne rien oublier

## M-01 — Registre des fonctionnalités

**Constat.** Le Project Brain connaît des tâches (`tasks.json`), des décisions (`decisions/`) et, s'il y a un cahier
des charges, des exigences (`spec.md`). Il ne connaît pas les **fonctionnalités** : « paiement par carte »,
« suivi du chauffeur », « export PDF ». Une fonctionnalité livrée il y a trois semaines n'existe plus que sous la
forme de tâches terminées noyées parmi les autres. `ceng similar` ne cherche que dans le code
(`src/app/similar.ts:21`).

**Quoi.** `.ceng/brain/features.json`, source de vérité, et `.ceng/brain/FEATURES.md`, vue lisible générée.
```ts
interface Feature {
  id: string;            // F-001
  name: string;          // « Paiement par carte »
  summary: string;       // une phrase : ce que l'utilisateur peut faire
  status: 'decided' | 'in_progress' | 'delivered' | 'rejected' | 'replaced';
  reason?: string;       // obligatoire pour rejected et replaced
  replacedBy?: string;   // F-xxx
  surfaces: string[];    // web, mobile, backoffice, api
  spec: string[];        // EX-xxx
  decisions: string[];   // fichiers ADR
  tasks: string[];       // T-xxxx
  files: string[];       // globs principaux, déduits des tâches terminées
  keywords: string[];    // synonymes donnés à la création
  updatedAt: string;
}
```

**Comment.**
- `src/domain/features.ts` (type, transitions de statut) ; `src/app/features.ts` (lecture, écriture atomique,
  rendu de `FEATURES.md` : un tableau par statut, 1 ligne par fonctionnalité).
- Commandes `ceng feature add|list|show|reject|replace` (`src/cli/commands/feature.ts`).
- Alimentation **sans effort de l'agent** :
  - `ceng task add --feature F-012` rattache la tâche ; `task start` passe la fonctionnalité en `in_progress` ;
  - `task done` : si toutes les tâches rattachées sont terminées → `delivered`, et `files` reçoit les globs des tâches ;
  - `ceng feature reject F-012 --reason "…"` garde la trace de ce qu'on a décidé de **ne pas** faire.
- Cadrage (`ceng-delivery` § 1) : après `spec.md`, une fonctionnalité par parcours ou capacité du cahier.
- Projet existant sans registre : `ceng feature import` propose une liste à partir des groupes de tâches terminées
  et des titres de décisions ; l'orchestrateur la corrige, l'humain n'a rien à faire.
- `renderIndex` (`src/brain/brief.ts`) : une ligne « Fonctionnalités : 14 livrées, 3 en cours, 2 écartées —
  FEATURES.md ».

**Tests.** `test/features.test.ts` : cycle de statut, raison obligatoire, passage automatique à `delivered`, import.

---

## M-02 — Rappel automatique à chaque message de l'humain

**Constat.** `src/hooks/handlers.ts:613-616` : le hook de message humain note seulement que l'humain est présent.
La règle « l'existant d'abord » (`ceng-orchestrate/SKILL.md:67-69`) dépend donc de la mémoire de l'orchestrateur,
exactement au moment où elle est la plus faible : nouvelle session, contexte vide, demande formulée autrement que
la première fois.

**Quoi.** À chaque message de l'humain, le hook compare la demande au registre, aux tâches et aux décisions, et
ajoute au contexte de Claude, **avant qu'il réponde**, ce qui s'en rapproche :
```
[ceng] Avant de créer quoi que ce soit, proche de cette demande :
- F-012 « Paiement par carte » — LIVRÉE (T-0031, T-0034) · lib/features/payment/**
- F-019 « Paiement en plusieurs fois » — ÉCARTÉE le 2026-10-02 : frais du prestataire trop élevés
- Décision 0007 « Prestataire de paiement : Stripe Connect » (acceptée)
Étendre ou corriger l'existant ; une décision écartée ne se rouvre qu'en le disant à l'humain.
```
Rien de proche : le hook reste silencieux (aucun jeton).

**Comment.**
- Un hook UserPromptSubmit peut renvoyer `hookSpecificOutput.additionalContext`. Source :
  https://code.claude.com/docs/en/hooks.
- `src/app/recall.ts` : `recall(store, prompt, limit = 5)` — `expandTerms(prompt)` (synonymes français/anglais déjà
  présents dans `src/domain/similarity.ts:58`), puis `scoreWords` (`similarity.ts:97`) sur : nom + résumé + mots-clés
  des fonctionnalités ; titres des tâches non annulées ; titres des décisions. Seuil identique à `findSimilar`
  (score ≥ 3). Uniquement des fichiers JSON et des titres : pas de parcours du code (trop lent pour un hook de
  10 secondes ; le code reste l'affaire de `ceng similar`).
- `userPrompt` : ignorer les messages de moins de 4 mots utiles, les commandes `/…` et les réponses courtes
  (« oui », « continue ») ; sinon renvoyer le bloc. 600 caractères au plus.
- Ne pas répéter : mémoriser dans `state.recalled` les identifiants déjà rappelés dans la session.
- Les fonctionnalités `rejected` et `replaced` sont toujours rappelées en premier quand elles correspondent :
  c'est là que l'oubli coûte le plus (refaire ce qu'on a écarté).

**À vérifier.** La qualité du rappel sur de vraies demandes en français parlé : mesurer sur 20 messages réels du
projet Steko ou onGo ; ajuster le seuil plutôt que d'ajouter des synonymes à la main.

**Tests.** `test/recall.test.ts` : demande reformulée retrouvée par synonyme, silence sans correspondance, message
court ignoré, pas de répétition, fonctionnalité écartée en tête.

---

## M-03 — Garde anti-doublon à la création d'une tâche

**Constat.** `createTask` (`src/app/tasks.ts:40-76`) vérifie les dépendances et les critères, jamais la
ressemblance avec une tâche ou une fonctionnalité existante.

**Quoi.** `ceng task add` refuse une tâche `feature` ou `ui` dont le titre ressemble fortement à une fonctionnalité
du registre ou à une tâche existante, sauf si l'orchestrateur déclare son intention :
- `--extends F-012` : la tâche étend l'existant (elle y est rattachée) ;
- `--feature F-020` : nouvelle fonctionnalité déjà enregistrée ;
- `--new "pourquoi ce n'est pas un doublon"` : raison journalisée.

**Comment.** `recall` (M-02) appelé dans la commande `task add` (`src/cli/commands/work.ts`), pas dans `createTask`
(qui reste pur et testable). Message d'erreur : la liste des correspondances et les trois options. Les tâches
`bug`, `test`, `chore`, `docs`, `refactor` ne sont pas concernées.

**Tests.** Compléter `test/lifecycle.test.ts` : refus, puis succès avec chacune des trois options.

---

## M-04 — `ceng similar` élargi

**Constat.** `src/cli/commands/context.ts:28-37` ne renvoie que des fichiers de code.

**Quoi.** Même commande, quatre sections : fonctionnalités (avec statut), tâches (en cours et terminées),
décisions, puis code comme aujourd'hui. La sortie JSON garde le champ actuel et en ajoute trois.

**Comment.** `similarCommand` appelle `recall` (M-02) avant `findSimilar`. Le message « Rien de proche… création
justifiée » ne s'affiche que si les quatre sections sont vides. `ceng brief` : la section « Existant proche à
RÉUTILISER » reçoit aussi les fonctionnalités liées.

**Tests.** Compléter `test/similar.test.ts`.

---

## M-05 — Décisions remplacées ou écartées, réponses de l'humain conservées

**Constat.**
- `ceng decision add` n'accepte que `accepted|provisional|pending` (`src/cli/commands/memory.ts:95-96`). Il n'y a
  aucune commande pour remplacer ou écarter une décision : la skill demande de « mettre l'ADR à jour (remplacée
  par …) » à la main (`ceng-orchestrate/SKILL.md:162-163`).
- `questionAnswered` (`src/hooks/handlers.ts:764-781`) applique les approbations mais ne garde pas le texte de la
  question et de la réponse : après compaction, une réponse de l'humain à une question de direction est perdue,
  et la question peut lui être reposée.

**Quoi et comment.**
- `ceng decision supersede <id> --by <id>` et `ceng decision reject <id> --reason "…"` : modifient la ligne de
  statut de l'ADR et ajoutent une ligne datée. `listDecisions` (fiche P-07 de l'audit) les exclut déjà des briefs.
- `questionAnswered` : ajouter chaque couple question/réponse à `.ceng/brain/answers.md`
  (`- 2026-11-17 · T-0042 · « Paiement à la livraison ? » → Non, carte uniquement`), 300 caractères par ligne,
  valeurs passées par `redact`.
- `recall` (M-02) lit aussi `answers.md` : une demande proche d'une réponse déjà donnée rappelle cette réponse.
- `resumeBrief` : « N réponses de l'humain consignées : answers.md ».

**Tests.** `test/answers-log.test.ts` : ligne écrite, délai d'attente non consigné, rappel par `recall`.

---

# B. Toujours livrer du solide

## S-01 — `ceng ready` : contrôle « prêt pour la production »

**Constat.** La fin de livraison (`ceng-delivery/SKILL.md` § 8) est une liste en prose : migrations rejouables,
`.env.example` à jour, README, décisions en ADR. Rien ne la vérifie.

**Quoi.** `ceng ready [--increment <groupe>]` : une liste de contrôles mécaniques, chacun avec son résultat et
l'action à faire. Devient une gate requise des tâches du domaine `release` et un passage obligé de la clôture
d'incrément (fiche N-04).

| Contrôle | Comment il est vérifié |
|---|---|
| Variables d'environnement documentées | noms lus dans le code (`process.env.X`, `Deno.env.get`, `String.fromEnvironment`, `os.environ`) absents de `.env.example` |
| Aucun secret suivi par git | `runSecretsGate` sur tout le dépôt, pas seulement le diff |
| Migrations rejouables | commande `migration` de la configuration |
| Dépôt propre | pas de `TODO` sans tâche, pas de sortie de débogage (règles existantes de `code-check` appliquées au dépôt entier) |
| Verrou de dépendances présent et suivi | `package-lock.json`, `pubspec.lock`, `poetry.lock`… |
| Erreurs remontées | une bibliothèque de suivi d'erreurs dans les dépendances, ou une décision « pas de suivi d'erreurs » |
| Point de santé | une route `/health` ou équivalent pour un service serveur |
| Intégration continue | un fichier de CI, ou une décision qui l'écarte |
| Exigences couvertes | `ceng spec coverage` (fiche P-13) |
| Décisions en attente | aucune décision `pending` à impact fort |

**Comment.** `src/app/ready.ts` : un tableau de contrôles `{ id, run(store): { status, detail, fix } }`, chacun
court et testable ; `src/cli/commands/ready.ts`. Un contrôle non applicable au projet est `skipped` avec la raison.
Un contrôle peut être levé durablement par une décision (`ceng decision add … --waives ready:health`) : le choix
reste tracé et n'est pas redemandé.

**Tests.** `test/ready.test.ts` : un cas rouge et un cas vert par contrôle.

---

## S-02 — Sécurité de la base prouvée par des tests

**Constat.** La skill `supabase-workflow` cite `supabase test db` (pgTAP) et `supabase db lint`, mais aucune gate ne
les exige. Une table peut partir en production avec une politique d'accès jamais testée. C'est la faille la plus
grave d'un produit Supabase, et elle est invisible sur les captures.

**Quoi.**
- Détection : `src/discovery/quality.ts` ajoute, si `supabase/config.toml` existe, les commandes `db-lint`
  (`supabase db lint --level warning`) et `db-test` (`supabase test db`).
- Nouvelle gate `db-security` (requise pour `kind: migration` et le domaine `database` sur un projet Supabase) :
  1. `db-lint` sans avertissement nouveau ;
  2. chaque table créée dans les migrations de la tâche est citée dans au moins un fichier `supabase/tests/*.sql` ;
  3. `db-test` vert.
- `ceng brief` : pour ces tâches, ligne « Test d'accès obligatoire : un utilisateur ne lit ni ne modifie les lignes
  d'un autre (pgTAP, `supabase/tests/`) ».

**Comment.** `src/app/gates.ts` : `runDbSecurityGate(root, task, files)` — extraction des noms de tables par
`create table (if not exists)? (schema.)?nom`, recherche du nom dans les fichiers de test. `GATE_IDS` et
`GATE_KINDS` : `'db-security': 'builtin'`. Complète la fiche P-12 de l'audit (contrôle à l'écriture) par une preuve
à l'exécution.

**À vérifier.** Les options exactes de `supabase db lint` et `supabase test db` dans la version installée.

**Tests.** `test/db-security.test.ts` : table sans test → échec ; avec test → délégation à la commande.

---

## S-03 — Budgets de performance avec référence

**Constat.** La gate `performance` (`src/domain/gates.ts:95-97`) lance une commande et regarde son code de sortie.
Il n'y a ni chiffre, ni référence, ni seuil : « mesurer avant/après » reste une intention.

**Quoi.** `.ceng/brain/perf-baseline.json` : `{ métrique: { value, unit, at, task } }`. La commande `performance`
du projet écrit des lignes `clé=valeur` (taille du bundle, temps de démarrage, p95 d'un point d'entrée, nombre de
requêtes SQL d'un parcours). La gate échoue si une métrique se dégrade de plus de 10 % (réglable) par rapport à la
référence, et met la référence à jour quand la tâche est terminée.

**Comment.** `src/app/perf.ts` : analyse des lignes `clé=valeur`, comparaison, sens de la métrique (plus petit =
mieux, par défaut). Dans `runGates`, branche `performance` : exécuter, comparer, détailler
(« bundle_kb : 412 → 498, +21 % »). `ceng perf show|reset <métrique>`. Skill `performance` : trois scripts types
(web, Flutter, API) qui produisent ce format. Budget absolu optionnel dans la configuration
(`perfBudgets: { bundle_kb: 500 }`), fixé au cadrage.

**Tests.** `test/perf.test.ts` : première mesure → référence ; régression → échec ; amélioration → nouvelle référence.

---

## S-04 — Registre des coûts de production

**Constat.** « Les coûts font partie de la conception » (`ceng-delivery/SKILL.md:21-22`) n'a aucun support :
personne ne peut dire ce que coûtera le produit à 1 000 ou 50 000 utilisateurs.

**Quoi.** `.ceng/brain/costs.json` : une ligne par service payant — nom, unité facturée, prix unitaire, source du
prix (URL et date), usage estimé par utilisateur actif et par mois, palier gratuit. `ceng cost [--users 1000]`
calcule la facture mensuelle estimée et la part de chaque service.

**Comment.**
- Les tâches des domaines `ai-llm`, `payments`, `maps`, `sms`, `email`, `storage`, `realtime` reçoivent la gate
  `cost` : le service utilisé doit avoir sa ligne (prix vérifié par `ceng-researcher`, source datée).
- Au cadrage, **une seule question à l'humain** : le budget d'exploitation mensuel visé à l'échelle cible.
  Ensuite `ceng cost` compare ; un dépassement crée une décision `pending` à impact fort, pas un blocage silencieux.
- `ceng ready` (S-01) affiche l'estimation ; le rapport de livraison la reprend.

**Tests.** `test/costs.test.ts` : calcul avec palier gratuit, dépassement signalé, service sans ligne → gate en échec.

---

## S-05 — Vérification après déploiement

**Constat.** Le journal des intentions (`src/app/intents.ts`) sait qu'un déploiement a été lancé et s'est terminé.
Il ne sait pas si le produit fonctionne après.

**Quoi.** Quand une commande classée `deploy` ou `prod-migrate` se termine avec succès, le hook `commandDone`
rappelle à l'agent, dans le résultat de l'outil : « Déploiement terminé : lancer `ceng verify` ». La commande
exécute `commands.smoke` (page d'accueil et point de santé qui répondent, parcours principal en lecture seule) et
enregistre le résultat. Échec → message avec la commande de retour arrière du fournisseur et tâche `bug` créée en
priorité.

**Comment.** `Commands.smoke?: string` (`src/discovery/profile.ts`) ; `src/cli/commands/verify.ts` ;
`commandDone` renvoie un `additionalContext` (PostToolUse) quand l'intention fermée est un déploiement. Le mode
sans humain (`shouldKeepWorking`) considère un déploiement non vérifié comme du travail restant.

**Tests.** Compléter `test/intents.test.ts` : rappel après déploiement réussi, rien après un échec ou une autre commande.

---

## S-06 — Nouvelle dépendance justifiée

**Constat.** « Dépendance nouvelle justifiée » figure dans les agents (`ceng-builder.md:40`) mais rien ne le voit.
La gate `compliance` ne lit les licences que pour npm et seulement sur certains domaines
(`src/app/gates.ts:103-111`, `src/domain/gates.ts:86-88`).

**Quoi.** Quand une écriture ajoute une dépendance à un manifeste (`package.json`, `pubspec.yaml`,
`pyproject.toml`, `requirements.txt`), l'agent reçoit tout de suite : « Nouvelle dépendance `x` : indiquer dans le
rapport pourquoi elle est nécessaire, ce qu'on a écarté, et sa licence. » La gate `report` vérifie que le rapport
de la tâche cite chaque dépendance ajoutée depuis le début de la tâche.

**Comment.** `src/domain/deps-diff.ts` : noms de dépendances avant/après (texte ancien et nouveau du hook, ou
diff depuis le commit de base — fiche P-01). Règle `new-dependency` dans `code-check` (avertissement). Dans
`runGates`, branche `report` : pour chaque dépendance ajoutée, le rapport doit contenir son nom.

**Tests.** `test/deps-diff.test.ts` : ajout détecté dans chaque format, montée de version ignorée.

---

## S-07 — Boîte de décisions unique (`ceng inbox`)

**Constat.** Ce qui attend l'humain est dispersé : `pending-approvals.md`, les décisions provisoires et en
attente, les tâches bloquées, les questions des workers (`status: blocked`), les escalades. Le brief de session en
cite une partie. L'humain ne peut pas savoir, en dix secondes, ce qu'on attend de lui.

**Quoi.** `ceng inbox` rassemble tout en une liste triée par impact, chaque ligne avec la question, la valeur prise
par défaut, ce qui en dépend et ce que coûte un changement d'avis. Trois niveaux :

| Niveau | Contenu | Ce qui se passe sans réponse |
|---|---|---|
| Bloquant | action à approbation, décision à impact fort dont dépend du travail | les tâches dépendantes attendent, le reste avance |
| À confirmer | décision provisoire prise par l'agent | elle tient ; confirmée en un clic |
| Pour information | décisions évidentes prises seul | rien à faire |

**Comment.**
- `src/app/inbox.ts` : agrégation des sources existantes en une liste `{ id, level, question, default, dependsOn, source }`.
- Hook `userPrompt` (avec M-02) : au premier message d'une session, une ligne « 2 décisions bloquantes,
  3 à confirmer : `ceng inbox` » ; l'orchestrateur les pose alors par l'invite, les bloquantes d'abord, quatre par appel.
- Le tableau de bord (fiche N-03) affiche cette liste en tête.
- Règle de tri, à écrire dans `ceng-orchestrate` (« Trier une décision ») : avant de mettre une décision dans la
  boîte, vérifier qu'elle n'a pas déjà sa réponse dans `answers.md` (M-05), le registre (M-01) ou une décision
  acceptée. C'est ce qui réduit réellement le nombre de questions.

**Décision à poser à l'humain** : une décision « à confirmer » à impact faible doit-elle devenir acceptée
automatiquement après un délai ?
- **A (recommandé)** : oui, après 7 jours et une session où l'humain a vu la boîte sans y toucher.
- **B** : non, elle reste « à confirmer » jusqu'à une réponse.

**Tests.** `test/inbox.test.ts` : agrégation, tri, question déjà répondue exclue.

---

## Ce qui reste réellement à l'humain

Avec ces mécanismes, ses interventions se réduisent à :

1. donner le cahier des charges et valider le plan de livraison (une invite) ;
2. fixer le budget d'exploitation mensuel (S-04) et le stade du projet ;
3. répondre aux décisions bloquantes de la boîte (S-07) : choix métier, risques, actions à approbation ;
4. regarder les captures de l'incrément quand il le souhaite (tableau de bord).

Tout le reste — retrouver l'existant, ne pas rouvrir ce qui est tranché, prouver la sécurité, tenir les
performances et les coûts, vérifier un déploiement — est contrôlé par l'outil.
