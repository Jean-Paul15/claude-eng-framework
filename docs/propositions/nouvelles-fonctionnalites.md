# Nouvelles fonctionnalités proposées pour ceng

Complément de `audit-fable.md` (qui corrige l'existant). Ici : ce qui n'existe pas encore. Chaque fiche dit quoi,
pourquoi, comment le faire dans ce dépôt, et ce qu'il faut vérifier avant. Rien n'est implémenté.

Même règles que l'audit : TypeScript, aucune dépendance, champs ajoutés optionnels, tests en `node:test`.
Coût : S = moins d'une heure d'agent, M = une à trois heures, L = plus.

## Vue d'ensemble

| ID | Fonctionnalité | Ce que ça change pour toi | Coût | Dépend de |
|---|---|---|---|---|
| N-01 | Tests relancés en arrière-plan après chaque écriture | l'agent apprend qu'il a cassé un test tout de suite, sans dépenser de jetons quand c'est vert | M | — |
| N-02 | Contrats gelés | deux agents en parallèle ne peuvent plus diverger sur l'API ou le schéma | M | — |
| N-03 | Tableau de bord de livraison (une page HTML) | tu vois l'état, les captures et les décisions en attente en un coup d'œil | M | P-05, P-13 |
| N-04 | Clôture d'incrément | un incrément n'est « livré » que si tout est prouvé, avec un rapport d'incrément | M | P-05, P-13 |
| N-05 | Pré-contrôle des magasins (`ceng store check`) | les motifs de rejet Apple connus sont détectés avant la soumission | M | — |
| N-06 | Leçons transformées en règles de contrôle | une erreur relevée en revue ne peut plus être réécrite | S | — |
| N-07 | Lecture du cahier des charges dans un contexte séparé | le PDF n'entre jamais dans la conversation de l'orchestrateur | S | — |
| N-08 | État injecté à l'ouverture de la skill | un aller-retour d'outil en moins à chaque session | S | — |
| N-09 | Frein automatique à l'approche des limites du compte | Opus est économisé dès la première limite atteinte | M | D-5 utile |
| N-10 | Avertissements de code groupés par lot | un seul message au lieu d'un par fichier | S | P-15 |

Ordre conseillé : N-01, N-02, N-06 (qualité immédiate) ; puis N-03 et N-04 (visibilité) ; N-05 avant la prochaine
application iOS ; le reste quand l'occasion se présente.

---

## N-01 — Tests relancés en arrière-plan après chaque écriture

**Quoi.** Après une écriture de code, les tests unitaires tournent en arrière-plan. Verts : rien n'est dit à
l'agent, aucun jeton dépensé. Rouges : l'agent est réveillé avec les 25 dernières lignes de la sortie.

**Pourquoi.** Aujourd'hui un test cassé n'est vu qu'à `ceng gate run`, en fin de tâche, après plusieurs fichiers
écrits par-dessus l'erreur. C'est le retour arrière le plus coûteux d'une longue livraison.

**Comment.**
- Claude Code accepte `asyncRewake: true` sur un hook de commande : il tourne en arrière-plan et réveille Claude
  quand il sort avec le code 2, en lui montrant la sortie d'erreur. Source : https://code.claude.com/docs/en/hooks.
- `src/generation/settings.ts`, `PostToolUse` : `{ matcher: 'Edit|Write|MultiEdit', hooks: [hook('tests-watch', { asyncRewake: true, timeout: 300 })] }`
  (ajouter `asyncRewake?: boolean` à `HookHandler`).
- `src/hooks/handlers.ts` (ou un nouveau `src/hooks/tests-watch.ts`, le fichier actuel étant déjà trop long) :
  1. sortir en 0 si `config.testsWatch?.enabled === false`, si le fichier n'est pas du code, ou s'il n'y a pas de
     commande `unit` dans la configuration ;
  2. anti-rebond : écrire l'heure dans `state.testsWatchAt`, attendre 3 secondes, sortir en 0 si une écriture plus
     récente a pris le relais (une seule exécution par rafale d'écritures) ;
  3. lancer la commande `unit` avec `runShell` (`src/infra/exec.ts`), limite de 4 minutes ;
  4. code 0 → sortie 0 sans texte ; sinon sortie 2 avec `tail(sortie, 25)` passé par `redact`.
- Garde de durée : mémoriser la durée de la dernière exécution ; au-delà de 90 secondes, désactiver et le dire une
  fois (« suite trop lente pour le contrôle continu : tests à la gate seulement »).
- `FrameworkConfig.testsWatch?: { enabled?: boolean; command?: string }` pour donner une commande plus rapide
  (tests liés au fichier, quand l'outil du projet le permet).

**À vérifier.** Que le réveil atteint bien un sous-agent (et pas seulement la session principale) : essai réel avec
un `ceng-builder`. Sinon, limiter au travail direct de l'orchestrateur et garder la gate pour les workers.

**Tests.** `test/tests-watch.test.ts` : vert → silencieux ; rouge → code 2 et sortie tronquée ; anti-rebond ;
désactivation au-delà du seuil.

---

## N-02 — Contrats gelés

**Quoi.** `ceng contract freeze <fichier…>` gèle un contrat partagé (schéma OpenAPI, types partagés, migration de
base, tokens de design). Tant qu'il est gelé, aucun worker ne peut le modifier ; un changement passe par
l'orchestrateur avec `ceng contract bump <fichier> --reason "…"`, qui liste les tâches en cours à prévenir.

**Pourquoi.** La skill de livraison demande « contrat d'abord, figé » pour le travail multi-surfaces, mais rien ne
l'impose : `--interfaces` n'est qu'une étiquette (`src/domain/types.ts:65-66`). Deux agents qui ajustent chacun le
contrat « juste un peu » est la première cause de casse en parallèle.

**Comment.**
- `src/app/contracts.ts` : `.ceng/brain/contracts.json` = `{ file, sha256, frozenAt, version }[]` ; fonctions
  `freeze`, `bump`, `isFrozen(rel)`, `drift()` (empreinte différente du fichier sur disque).
- `src/hooks/handlers.ts`, `guardFile` : si `input.agent_id` et `isFrozen(rel)` → refus avec le message « contrat
  gelé : décris le changement nécessaire dans ton rapport (`status: blocked`) ». La session principale n'est pas
  bloquée, mais reçoit un rappel de lancer `contract bump`.
- `ceng contract bump` : recalcule l'empreinte, incrémente la version, ajoute une ligne à l'ADR du contrat, et
  affiche les tâches `in_progress` dont `interfaces` ou `files` touchent ce contrat.
- `ceng gate run` : avertissement si `drift()` n'est pas vide (contrat modifié sans `bump`).
- `src/cli/commands/context.ts` : section « Contrats gelés (lecture seule) » dans le brief.
- Skill `ceng-delivery` § 5, point 1 : remplacer « Figé (`--interfaces`) » par la commande.

**Tests.** `test/contracts.test.ts` : gel, refus pour un sous-agent, passage pour la session principale, `bump`,
dérive détectée. En bypass : le verrou reste (il évite un conflit, pas une action), comme le verrou entre agents.

---

## N-03 — Tableau de bord de livraison

**Quoi.** `ceng report --html` écrit `.ceng/report/index.html` : une page autonome, lisible sur téléphone, avec
l'avancement par incrément, les tâches bloquées, les décisions à confirmer, les exigences du cahier couvertes ou
non, et les captures de chaque parcours.

**Pourquoi.** Tu viens « de temps en temps ». Aujourd'hui il faut lire `INDEX.md`, des rapports et des dossiers
d'images. Une page unique respecte ta règle : la bonne information au bon moment, une action à la fois.

**Comment.**
- `src/generation/report-html.ts` : fonction pure `renderReport(data): string` (HTML et CSS en ligne, aucune
  ressource externe, thème clair et sombre par `prefers-color-scheme`). Données : tâches, gates, décisions
  provisoires ou en attente, `pending-approvals.md`, couverture des exigences (P-13), captures de `.ceng/shots/`
  (P-05) référencées par chemin relatif.
- Structure en révélation progressive : en haut trois chiffres (livré, en cours, bloqué) et « ce qui t'attend »
  (décisions) ; chaque incrément est un bloc replié (`<details>`) ; les captures s'ouvrent au clic.
- Maquette du cahier (`docs/spec/assets/`) et capture livrée côte à côte quand le nom de l'écran correspond.
- `src/cli/commands/memory.ts` (là où vit `reportCommand`) : option `--html` ; `.ceng/report/` ajouté au
  `GITIGNORE_BLOCK`.
- Skill `ceng-delivery` § 8 : le rapport final renvoie à cette page.

**Tests.** `test/report-html.test.ts` : page valide sans tâche ; décisions en attente en tête ; aucun secret (la
sortie passe par `redact`) ; pas d'URL externe.

---

## N-04 — Clôture d'incrément

**Quoi.** `ceng increment close <groupe>` vérifie qu'un incrément est réellement livrable, puis écrit
`.ceng/brain/increments/<groupe>.md` (ce qui est livré, captures, hypothèses, décisions à confirmer).

**Pourquoi.** La skill parle d'incréments démontrables et de « rétro express », mais l'incrément n'existe pas dans
l'outil : seulement un champ `group` libre sur les tâches (`src/cli/commands/work.ts:46`). Rien n'empêche de passer
à l'incrément suivant avec des tâches à moitié prouvées.

**Comment.**
- `src/app/increments.ts`, contrôles dans l'ordre, chacun avec un message d'action :
  1. toutes les tâches du groupe sont `done`, aucune dérogation sans raison ;
  2. chaque tâche d'interface a des captures (`visualEvidence`, P-05) ;
  3. les exigences rattachées (`spec`, P-13) sont toutes couvertes par une tâche terminée ;
  4. la suite complète passe (`commands.unit`, puis `e2e` si elle existe) — une fois pour l'incrément, pas par tâche ;
  5. si `supabase/` existe : les migrations se rejouent à blanc (commande `migration` de la configuration).
- Sortie : rapport d'incrément, puis appel de `adapt` (la rétro) et rappel `ceng learn add`.
- `ceng plan` : prévenir quand on démarre un groupe alors que le précédent n'est pas clos.

**Tests.** `test/increments.test.ts` : refus sur tâche non terminée, sur capture manquante, succès complet.

---

## N-05 — Pré-contrôle des magasins

**Quoi.** `ceng store check` lit le projet mobile et signale les motifs de rejet détectables sans lancer
l'application. Nouvelle gate optionnelle `store` sur les tâches du domaine `release`.

**Pourquoi.** Le rejet 5.1.1(v) a coûté un cycle de soumission. La skill `ios-release` liste les règles, mais leur
respect repose sur la mémoire de l'agent. Une partie se vérifie mécaniquement.

**Comment.** `src/domain/store-check.ts`, règles pures sur le texte des fichiers :

| Règle | Détection | Guideline |
|---|---|---|
| Texte de permission manquant | une clé d'usage (`NSCameraUsageDescription`, localisation, photos, micro…) absente de `Info.plist` alors que le paquet correspondant est dans `pubspec.yaml` ou `package.json` | 5.1.1 |
| Texte de permission vide ou générique | valeur de moins de 20 caractères | 5.1.1 |
| Connexion Apple absente | paquet de connexion Google ou Facebook présent, aucun paquet « Sign in with Apple » | 4.8 |
| Suppression de compte introuvable | inscription détectée, aucune occurrence de suppression de compte dans le code | 5.1.1(v) |
| Manifeste de confidentialité absent | pas de `PrivacyInfo.xcprivacy` dans `ios/` | exigence Apple en vigueur |
| Paiement externe pour un bien numérique | SDK de paiement présent sans achat intégré — signalé comme question, pas comme erreur | 3.1.1 |

- Le mur d'inscription (5.1.1(v)) ne se prouve pas par le code : il reste vérifié par le test visuel, avec un
  scénario obligatoire « premier lancement sans compte » ajouté à `visual-flow-testing` § 1.
- Sortie classée (bloquant, à confirmer), chaque ligne avec la guideline et le fichier.

**À vérifier.** La liste des paquets par permission (à établir par `ceng-researcher` depuis les pages officielles
citées dans `ios-release` § 0) ; les règles Google Play équivalentes dans un second temps.

**Tests.** `test/store-check.test.ts` avec de petits projets d'exemple dans `examples/`.

---

## N-06 — Leçons transformées en règles de contrôle

**Quoi.** `ceng learn add --pattern "<regex>" --message "…" [--glob "src/**/*.ts"]` ajoute une règle propre au
projet au contrôle immédiat du code. Le relecteur propose ces règles dans son rapport.

**Pourquoi.** Une leçon écrite n'est relue que si un agent pense à la charger. Une règle s'applique à chaque
écriture, sans jeton tant que tout va bien. C'est le moyen le plus sûr de ne pas refaire deux fois la même erreur.

**Comment.**
- `.ceng/brain/rules.json` : `{ id, pattern, message, glob?, severity: 'warn', addedBy, at }[]`.
- `src/domain/code-check.ts` : `checkCode(…, limits, custom = [])` applique chaque règle au texte écrit (expression
  compilée dans un `try`, règle ignorée si elle est invalide ; 30 règles au plus ; avertissement seulement).
- `src/hooks/handlers.ts`, `codeCheck` : charger `rules.json`.
- `core/agents/ceng-reviewer.md` : champ `rule_candidates:` dans le rapport (« motif récurrent qui mérite une
  règle : expression + message ») ; l'orchestrateur décide et lance la commande.
- `ceng adapt` : signaler une règle jamais déclenchée depuis 50 tâches (à retirer).

**Tests.** Compléter `test/code-check.test.ts` : règle appliquée, limitée par glob, expression invalide ignorée.

---

## N-07 — Lecture du cahier des charges dans un contexte séparé

**Quoi.** Nouvelle skill `ceng-spec-intake` qui s'exécute dans un sous-agent : elle lit le PDF, extrait les images
et écrit `.ceng/brain/spec.md`. L'orchestrateur ne reçoit que le résumé.

**Pourquoi.** Ton prochain cahier contient beaucoup d'images. La procédure existe (`ceng-delivery` § 1) mais elle
est décrite à l'orchestrateur : s'il lit lui-même vingt pages illustrées, sa conversation est pleine avant d'avoir
planifié.

**Comment.**
- `core/skills/ceng-spec-intake/SKILL.md` avec le frontmatter `context: fork`, `agent: general-purpose`,
  `model: sonnet`, `background: false`, `argument-hint: "<chemin du cahier>"`. Source :
  https://code.claude.com/docs/en/skills (champs `context`, `agent`, `background`).
- Corps : la procédure PDF déplacée depuis `ceng-delivery/SKILL.md` (lecture par lots de 20 pages, extraction des
  images vers `docs/spec/assets/`, exigences numérotées EX-xxx avec la page source, maquettes imposées ou
  indicatives), et le format de retour : nombre d'exigences, surfaces, trous à impact fort (5 au plus).
- `ceng-delivery` § 1 garde trois lignes et renvoie à la skill : environ 900 octets de moins (aide P-14).
- `src/generation/catalog.ts` : entrée `always`.

**À vérifier.** Qu'un sous-agent lancé ainsi lit bien les images d'un PDF avec l'outil Read (essai sur un PDF de
quelques pages).

---

## N-08 — État injecté à l'ouverture de la skill

**Quoi.** À l'invocation de `ceng-orchestrate`, l'état courant (tâche en cours, lots prêts, décisions en attente)
est déjà dans le texte de la skill.

**Pourquoi.** Chaque session commence par un appel `ceng resume` ou la lecture d'`INDEX.md` : un aller-retour
systématique que la skill peut faire elle-même.

**Comment.**
- Les skills acceptent l'injection d'une commande, exécutée avant que le texte n'arrive au modèle. Source :
  https://code.claude.com/docs/en/skills (« dynamic context injection »).
- `core/skills/ceng-orchestrate/SKILL.md`, § 0 : remplacer « Lis le brief… Lis INDEX.md » par un bloc
  « État actuel » contenant la commande injectée `node .ceng/runtime/cli.js resume --compact`.
- `src/cli/commands/memory.ts` : option `--compact` (20 lignes au plus) qui **sort toujours en code 0**, même projet
  non initialisé — une commande en échec annule toute l'invocation de la skill.

**À vérifier.** Le shell utilisé sous Windows (champ `shell: powershell` possible) et le comportement quand
`disableSkillShellExecution` est activé : garder la phrase de repli « sinon lance `ceng resume` ».

---

## N-09 — Frein automatique à l'approche des limites du compte

**Quoi.** Quand une limite d'usage a interrompu une session, le framework passe en mode économe jusqu'à la
réinitialisation : seuils d'appel à Opus relevés, relecture d'images sur Sonnet, un seul agent à la fois.

**Pourquoi.** Tu atteins ton plafond hebdomadaire. Aujourd'hui le routage ne sait rien de l'usage réel : il
continue à envoyer vers Opus jusqu'au blocage.

**Comment.**
- `src/hooks/handlers.ts`, `stopFailure` : si le type d'erreur indique une limite d'usage, écrire
  `state.throttle = { since, until }` (`until` : heure de réinitialisation si le message la donne, sinon 5 heures).
- `src/app/tasks.ts`, `routeAndStore` : si `throttle` est actif, router avec `budget: 'economy'` sans toucher à la
  configuration, et ajouter la raison « frein de limite actif jusqu'à … ». Les planchers des domaines critiques ne
  bougent pas (c'est déjà la règle de `routing.ts:66-70`).
- `src/domain/planner.ts` : parallélisme ramené à 1 pendant le frein.
- Brief de session : une ligne « frein actif ». `ceng config throttle off` pour le lever à la main (après une
  réinitialisation d'usage).
- Avec D-5 (jetons réels par agent) : déclencher le frein avant le blocage, sur un budget hebdomadaire fixé dans
  la configuration.

**Relance automatique après la réinitialisation** (demande de l'humain).
- Ce qui existe : en mode nuit, `src/cli/commands/night.ts:94-96` attend après une interruption `rate_limit` puis
  relance, mais avec une attente fixe (`--wait-minutes`, 15 par défaut) répétée à l'aveugle, et seulement si la
  session a été lancée par `ceng run --unattended`. Une session interactive coupée par la limite ne repart jamais
  seule.
- À faire, mode nuit : remplacer l'attente fixe par une attente jusqu'à `state.throttle.until` (plus 2 minutes de
  marge), bornée par `--max-hours`. Heure de réinitialisation inconnue : attente progressive 15, 30, 60 minutes au
  lieu de 15 en boucle (chaque relance ratée consomme une des `--max-runs`).
- À faire, session interactive : nouvelle commande `ceng run --resume-after-limit`, lancée par le hook
  `stopFailure` en processus détaché (même mécanique que `upgradeInBackground`, `src/app/registry.ts:79-82`) quand
  `config.autoResume?.enabled === true`. Elle attend `throttle.until`, vérifie qu'aucune autre session ceng n'est
  active sur le projet (verrou de `src/infra/lock.ts`, et `state.lastSessionAt` plus récent que l'interruption →
  abandon : l'humain a déjà repris), puis lance `ceng run --unattended --resume` avec les limites du mode nuit.
- Garde-fous de la relance : désactivée par défaut (`ceng config auto-resume on|off`, décision de l'humain, posée
  à l'installation — voir la skill `ceng-setup`) ; une seule relance en attente par projet (`state.resumeAt`) ;
  la session relancée travaille sans humain, donc avec les règles du mode nuit (actions à approbation consignées
  dans `pending-approvals.md`, sauf bypass total) ; le frein économe reste actif pendant la première heure après
  la reprise ; tout est journalisé (`session.resume-scheduled`, `session.resumed`).
- `core/skills/ceng-setup/SKILL.md` § 2 : ajouter la question « Relancer le travail tout seul après une limite
  d'usage ? » au second appel de l'invite (avec graphify).

**À vérifier.** Le libellé exact du type d'erreur reçu par le hook StopFailure pour une limite d'usage, et si le
message donne l'heure de réinitialisation (lire un événement réel dans `.ceng/logs/events.jsonl`). Qu'un processus
détaché lancé depuis un hook survit à la fermeture de l'application Claude sous Windows (essai réel) ; sinon,
passer par une tâche planifiée du système.

**Tests.** `test/throttle.test.ts` : frein posé, routage plus économe, plancher critique conservé, expiration ;
relance planifiée une seule fois ; abandon si l'humain a repris ; aucune relance quand l'option est désactivée.

---

## N-10 — Avertissements de code groupés par lot

**Quoi.** Quand l'agent écrit plusieurs fichiers d'un coup, il reçoit un seul message regroupant les avertissements.

**Pourquoi.** Dix écritures parallèles produisent dix messages séparés, avec dix fois l'en-tête.

**Comment.** Claude Code émet `PostToolBatch` une fois par lot d'appels d'outils, avec la liste des appels ; le hook
peut renvoyer un `additionalContext` unique. Source : https://code.claude.com/docs/en/hooks.
- `settings.ts` : `PostToolBatch: [{ hooks: [hook('code-check-batch', { timeout: 15 })] }]`.
- Le contrôle par fichier ne garde que les défauts bloquants (secret en dur, injection, `eval`) ; les
  avertissements passent dans le gestionnaire de lot, dédoublonnés par règle (« long-line : 4 fichiers »).

**À vérifier.** Que l'événement se déclenche aussi dans un sous-agent. À faire après P-15, qui touche les mêmes hooks.
