# Sécurité dès la conception et conformité légale — socle obligatoire

Quatrième document de propositions. Objectif fixé par l'humain : quel que soit le framework utilisé, le produit
livré est réellement sécurisé, respecte la loi, et embarque **d'office** les mécanismes qu'une application sérieuse
doit avoir : acceptation des politiques et ré-acceptation quand elles changent, détection d'anomalies, capacité à
savoir vite qui est touché par un incident, gouvernance des données, nettoyage automatique de la base.

Rien n'est implémenté. Mêmes conventions que les autres documents (TypeScript, aucune dépendance, tests `node:test`).

## 0. Constat sur l'existant

- `core/skills/security/SKILL.md` : bonne liste OWASP, mais uniquement des **défauts à éviter**. Elle ne dit pas ce
  qu'une application doit **contenir** (journal d'audit, détection, réponse à incident).
- `core/skills/legal-governance/SKILL.md:22-28` : le RGPD est résumé en cinq puces (« durée définie et suppression
  effective », « droits d'accès, effacement »). Ce sont des intentions : aucun mécanisme n'est décrit, aucun n'est
  vérifié. La ré-acceptation d'une politique modifiée, la preuve du consentement, la détection d'anomalies et
  l'analyse d'impact d'un incident n'y figurent pas.
- `src/app/gates.ts:94-122` (`runComplianceGate`) : contrôle les licences npm et écrit des notes. Pour les données
  personnelles, il affiche un rappel (`gates.ts:116-119`) et ne bloque jamais.
- Conséquence : un produit peut passer toutes les gates et partir en production sans suppression de compte, sans
  durée de conservation appliquée, sans trace de qui a lu quoi.

**Limite à garder en tête.** L'agent n'est pas juriste (`legal-governance/SKILL.md:8-9`). Ce document rend
obligatoires des **mécanismes techniques** reconnus ; il ne remplace pas un avis juridique. Les articles cités sont
ceux du RGPD (UE). La loi du pays d'exploitation doit être lue à la source au cadrage (fiche G-4).

## 1. Vue d'ensemble

| ID | Élément | Nature | Coût |
|---|---|---|---|
| G-1 | Skill `compliance-by-design` : le socle obligatoire et son SQL de référence | texte + référence | M |
| G-2 | Manifeste de conformité : chaque mécanisme prouvé, ou écarté par une décision | outil (gate) | M |
| G-3 | Classification des données dans la base elle-même | outil (gate) | M |
| G-4 | Cadrage légal : pays, public, données sensibles — une invite, puis lecture des lois à la source | texte | S |
| G-5 | Skill `security` renforcée : principes indépendants du framework | texte | S |
| G-6 | Tests d'abus obligatoires sur les domaines sensibles | outil (gate) | S |
| G-7 | Contrôles de sécurité dans `ceng ready` | outil | S |

Les mécanismes du socle (C-01 à C-14) sont décrits au § 2 : ce sont eux que G-1 rend obligatoires et que G-2 vérifie.

Ordre conseillé : G-1 et G-5 (texte, en parallèle) → G-4 → G-2 → G-3 → G-6 → G-7.

---

## 2. Le socle obligatoire (contenu de la skill G-1)

**Règle de déclenchement.** Dès qu'un produit a des **comptes utilisateurs** ou stocke une **donnée personnelle**
(nom, e-mail, téléphone, position, photo, identifiant d'appareil, adresse IP rattachée à une personne), tout le
socle s'applique. Il est construit dans le premier incrément, avec le modèle de données — pas « avant la mise en
production ». Un mécanisme ne peut être écarté que par une décision tracée de l'humain (G-2).

Chaque mécanisme est décrit par ce qu'il doit garantir, pas par une technologie : il se réalise en SQL, dans un
ORM ou dans un service, selon la pile. Le SQL de référence (PostgreSQL) sert de modèle à adapter.

### C-01 — Politiques versionnées et ré-acceptation

**Garantit** : on sait, pour chaque utilisateur, quelle version de chaque document il a acceptée, quand, et comment ;
une modification importante oblige à ré-accepter avant de continuer. (RGPD art. 7 : preuve du consentement ;
art. 13 : information.)

```sql
create table legal_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('terms', 'privacy', 'cookies')),
  version text not null,
  locale text not null,
  content_sha256 text not null,
  summary_of_changes text not null,
  requires_reacceptance boolean not null,
  published_at timestamptz not null,
  unique (kind, version, locale)
);
create table legal_acceptances (
  user_id uuid not null references users(id) on delete cascade,
  document_id uuid not null references legal_documents(id),
  accepted_at timestamptz not null default now(),
  method text not null,            -- 'signup_checkbox', 'reacceptance_screen'
  primary key (user_id, document_id)
);
```
Règles :
- La vérification est faite **côté serveur** : une fonction `needs_reacceptance(user_id)` appelée par le garde
  d'accès de l'API (intergiciel, politique d'accès ou fonction de base). Un écran seul ne suffit pas.
- Écran de ré-acceptation : résumé des changements en langage simple, lien vers le texte complet, bouton
  « J'accepte » et issue claire en cas de refus (exporter ses données, supprimer son compte). Jamais de case pré-cochée.
- Changement mineur (faute, reformulation) : `requires_reacceptance = false`, simple information.
- Les textes publiés ne sont jamais modifiés : une nouvelle version est une nouvelle ligne. L'empreinte prouve le texte accepté.
- Application mobile : la navigation sans compte reste possible (règle Apple 5.1.1(v), skill `ios-release`) ;
  l'acceptation est demandée à la création du compte et à la connexion suivante après un changement.
- Test obligatoire : un utilisateur dont l'acceptation date d'une version antérieure reçoit un refus de l'API tant
  qu'il n'a pas ré-accepté.

### C-02 — Consentement par finalité, retirable

**Garantit** : chaque usage non indispensable (mesure d'audience, publicité, e-mails commerciaux, partage avec un
tiers) a son consentement propre, donné par une action positive, retirable aussi facilement qu'il a été donné
(RGPD art. 7(3)), et historisé.

- Table `consents(user_id, purpose, granted, at, source)` en ajout seul : l'état courant est la dernière ligne.
- Aucun outil de mesure, de publicité ou SDK tiers ne se charge avant le consentement correspondant.
- Écran « Confidentialité » dans les réglages : un interrupteur par finalité, effet immédiat.
- E-mails commerciaux : lien de désinscription en un clic dans chaque message.

### C-03 — Carte des données (registre des traitements)

**Garantit** : pour chaque donnée personnelle, on connaît sa catégorie, sa finalité, sa base légale, sa durée de
conservation et les tiers qui la reçoivent (RGPD art. 30). Voir G-3 : la carte vit dans la base, sous forme de
commentaires de colonnes, et se vérifie mécaniquement.

### C-04 — Durées de conservation et nettoyage automatique

**Garantit** : aucune donnée personnelle n'est gardée au-delà de sa durée (RGPD art. 5(1)(e)) ; le nettoyage tourne
seul et laisse une trace.

```sql
create table retention_rules (
  id text primary key,                 -- 'sessions_expired', 'accounts_deleted', 'logs_90d'
  target_table text not null,
  condition_sql text not null,         -- ex. 'deleted_at < now() - interval ''30 days'''
  action text not null check (action in ('delete', 'anonymize')),
  legal_reason text not null,
  enabled boolean not null default true
);
create table retention_runs (
  id bigserial primary key, rule_id text not null, started_at timestamptz not null default now(),
  rows_affected integer not null, ok boolean not null, error text
);
```
Règles :
- Une tâche planifiée (planificateur de la base, tâche du serveur ou fonction programmée) exécute chaque règle par
  **lots bornés** (par exemple 5 000 lignes), pour ne jamais verrouiller une table.
- `anonymize` remplace les champs identifiants et garde la ligne quand elle sert aux statistiques ou à une
  obligation comptable. Les pièces à conserver par obligation légale (factures) sont **exclues** du nettoyage, avec
  la durée légale notée dans `legal_reason` — durée à vérifier pour le pays (G-4).
- Règles minimales : sessions et jetons expirés, comptes supprimés après le délai de grâce, comptes jamais activés,
  journaux techniques, fichiers téléversés orphelins, exports de données générés, brouillons abandonnés.
- Les sauvegardes ont elles aussi une durée d'expiration, écrite dans la décision d'hébergement.
- Une exécution en échec ou absente depuis 48 heures déclenche une alerte (C-07).
- Test obligatoire : une ligne périmée est supprimée ou anonymisée, une ligne récente ne l'est pas, une pièce sous
  obligation légale reste intacte.

### C-05 — Droits des personnes : export et suppression

**Garantit** : chaque utilisateur peut, depuis l'application, obtenir une copie de ses données dans un format
lisible par une machine et supprimer son compte (RGPD art. 15, 17, 20 ; réponse sous un mois, art. 12(3) ; exigence
des magasins d'applications).

- Suppression : demande → désactivation immédiate → délai de grâce → purge par la règle `accounts_deleted` de C-04.
  La purge suit la carte des données : toutes les tables, les fichiers stockés et les tiers (prestataire de
  paiement, e-mail, mesure d'audience) sont traités, et la liste traitée est journalisée.
- Export : tâche asynchrone, archive JSON, lien à durée limitée, réservé au titulaire ré-authentifié.
- Rectification : chaque donnée de profil est modifiable par son titulaire.
- Test obligatoire : après la purge, aucune table de la carte des données ne contient l'identifiant de l'utilisateur.

### C-06 — Journal d'audit en ajout seul

**Garantit** : on peut reconstituer qui a fait quoi, quand, et **qui a consulté quelles données** — base de la
détection (C-07) et de l'analyse d'impact (C-08). (RGPD art. 5(2) : responsabilité ; art. 32 : sécurité.)

```sql
create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid, actor_role text not null,       -- 'user', 'admin', 'service', 'system'
  action text not null,                          -- 'read', 'create', 'update', 'delete', 'export', 'login', 'role_change'
  entity text not null, entity_id text,
  subject_user_id uuid,                          -- la personne dont la donnée est touchée
  request_id text, ip inet, reason text
);
revoke update, delete on audit_log from public;
create index audit_log_subject_at on audit_log (subject_user_id, at);
create index audit_log_actor_at on audit_log (actor_id, at);
```
Règles :
- Écritures sensibles : journalisées par déclencheur ou dans la couche de service, jamais « quand on y pense ».
- **Lectures** de données personnelles par un administrateur ou un compte de service : journalisées aussi, avec le
  motif (`reason`) pour les données sensibles.
- Le journal ne contient ni secret ni contenu personnel : des identifiants, pas des valeurs.
- Personne ne peut le modifier, y compris le rôle applicatif. Sa durée de conservation est une règle de C-04.

### C-07 — Détection d'anomalies

**Garantit** : un comportement anormal est repéré en minutes, pas découvert des mois plus tard.

Signaux minimaux, chacun une requête planifiée sur `audit_log` et les tables d'authentification :

| Signal | Seuil de départ (réglable) | Réponse automatique |
|---|---|---|
| Un compte lit les données de nombreuses personnes différentes | plus de 200 personnes distinctes en 1 heure | alerte ; suspension des jetons du compte s'il n'est pas administrateur |
| Rafale d'échecs de connexion sur un compte ou depuis une adresse | 10 en 10 minutes | blocage temporaire croissant, alerte |
| Rafale de refus d'accès (tentatives sur les données d'autrui) | 20 en 10 minutes pour un même acteur | alerte, limitation du débit |
| Export ou téléchargement massif | 3 exports en 1 heure | alerte, export suivant mis en attente |
| Changement de rôle ou de privilège | chaque occurrence | alerte immédiate au propriétaire |
| Connexion administrateur depuis un appareil ou un pays nouveau | chaque occurrence | nouvelle vérification, alerte |
| Tâche de nettoyage ou sauvegarde en échec | 1 échec ou 48 heures sans exécution | alerte |
| Volume de suppressions ou de modifications inhabituel | 10 fois la moyenne des 7 derniers jours | alerte |

- Tables `security_alerts(id, at, signal, severity, actor_id, details, status)` et un canal de notification vers le
  propriétaire (e-mail ou webhook), configuré au cadrage.
- Limitation du débit sur toute route d'authentification, d'export, de recherche et de paiement.
- Les seuils sont des données (table de configuration), ajustés sur l'usage réel après le lancement.
- Test obligatoire par signal : un scénario qui dépasse le seuil crée l'alerte.

### C-08 — Réponse à incident : savoir vite qui est touché

**Garantit** : en cas de fuite ou de compte compromis, on obtient en quelques minutes la liste des personnes
concernées et des données touchées. Le RGPD impose de notifier l'autorité sous 72 heures (art. 33) et d'informer
les personnes en cas de risque élevé (art. 34).

- Fonction `affected_subjects(acteur | table | fenêtre de temps)` : s'appuie sur `subject_user_id` de `audit_log`
  et renvoie les personnes, les catégories de données (d'après la carte C-03) et la période.
- Table `security_incidents(id, detected_at, description, scope, affected_count, notified_authority_at,
  notified_subjects_at, closed_at)` : le registre des incidents, obligatoire même sans notification (art. 33(5)).
- Leviers d'urgence prêts et testés : révoquer toutes les sessions (ou celles d'un compte), suspendre un compte,
  passer l'application en lecture seule, faire tourner les clés et secrets.
- Fiche de conduite `docs/security/incident.md` (une page) : qui prévenir, dans quel ordre, les leviers, le compte à
  rebours de 72 heures, les modèles de message à l'autorité et aux personnes.
- Test obligatoire : après une série de lectures simulées par un compte, `affected_subjects` renvoie exactement les
  personnes lues.

### C-09 — Authentification et sessions

Fournisseur d'identité reconnu plutôt que du code maison ; expiration et rotation des jetons ; révocation côté
serveur ; pas d'indice permettant de savoir si un compte existe (mêmes messages et délais) ; refus des mots de passe
compromis connus ; double authentification obligatoire pour les administrateurs.

### C-10 — Administration et moindre privilège

Rôles distincts (support, finance, administrateur technique), aucun compte partagé, accès aux données sensibles
avec motif obligatoire et journalisé (« bris de glace »), actions en masse soumises à confirmation, revue périodique
des comptes privilégiés (liste produite par une requête, rappel trimestriel dans la boîte de décisions).

### C-11 — Isolation des données

Refus par défaut à la couche de données (politiques d'accès au niveau des lignes, ou filtre obligatoire porté par
la couche d'accès) : l'autorisation ne repose jamais sur le seul code de l'écran. Produit multi-clients : test
d'isolation obligatoire entre deux clients pour chaque table.

### C-12 — Tiers et transferts

Registre des sous-traitants (`.ceng/brain/processors.md` : service, données reçues, finalité, pays d'hébergement,
contrat de traitement signé ou non). Tout nouveau tiers est une décision de l'humain. Région d'hébergement choisie
au cadrage. Fonction d'IA : aucune donnée personnelle envoyée au fournisseur sans base légale, option de
non-utilisation pour l'entraînement activée.

### C-13 — Chiffrement, secrets, sauvegardes

Chiffrement en transit partout ; colonnes très sensibles chiffrées au repos (pièce d'identité, donnée de santé,
coordonnées bancaires — à éviter : les laisser au prestataire) ; secrets hors du code, avec une procédure de
rotation écrite ; sauvegardes chiffrées et **restauration testée** (une sauvegarde jamais restaurée n'en est pas une).

### C-14 — Journaux et suivi d'erreurs sans données personnelles

Filtre central qui masque e-mails, téléphones, jetons et corps de requêtes avant écriture ; suivi d'erreurs
configuré pour ne pas envoyer les données d'utilisateur par défaut ; test qui prouve qu'un e-mail passé dans une
erreur n'apparaît pas dans le journal.

### Autres obligations à ne pas oublier

- **Pages légales** accessibles sans compte : conditions d'utilisation, politique de confidentialité, mentions de
  l'éditeur, contact pour exercer ses droits. Vente en ligne : conditions de vente, prix toutes taxes, droit de
  rétractation selon le pays.
- **Bandeau de consentement** pour les traceurs non indispensables, avec « Refuser » aussi visible qu'« Accepter ».
- **Déclarations des magasins** cohérentes avec la carte des données : étiquettes de confidentialité Apple,
  autorisation de suivi (App Tracking Transparency), formulaire de sécurité des données Google Play.
- **Mineurs** : âge minimum, consentement parental selon le pays ; données de santé, biométrie, position précise :
  catégories à signaler dès le cadrage.
- **Analyse d'impact** (RGPD art. 35) à proposer à l'humain quand le produit fait du suivi à grande échelle, du
  profilage ou traite des données sensibles.
- **Signalement de faille** : fichier `security.txt` et adresse de contact.
- **Fichiers téléversés** : type et taille vérifiés côté serveur, stockage hors de la racine servie, noms régénérés.
- **Accessibilité** : obligation légale dans de nombreux pays (déjà dans `legal-governance`).

---

## 3. Fiches d'implémentation dans ceng

### G-1 — Skill `compliance-by-design`

**Changement.**
- Créer `core/skills/compliance-by-design/SKILL.md` : la règle de déclenchement et les mécanismes C-01 à C-14 sous
  forme condensée (ce qu'il garantit, règles, test obligatoire), plus la liste « autres obligations ». Viser moins
  de 12 000 octets ; le SQL va dans un fichier séparé.
- Créer `core/skills/compliance-by-design/reference.sql` : le SQL de référence du § 2, complet (tables, index,
  fonction `needs_reacceptance`, fonction `affected_subjects`, requêtes des signaux de C-07, tâche de nettoyage par
  lots). En tête : « modèle PostgreSQL à adapter à la pile ; ne pas recopier sans relire ».
- `src/generation/catalog.ts` : entrée `always`.
- `core/skills/legal-governance/SKILL.md:22-28` : remplacer les cinq puces RGPD par un renvoi à la nouvelle skill,
  en gardant la règle « nouvelle catégorie de données ou nouveau sous-traitant → approbation humaine ».
- `core/skills/ceng-delivery/SKILL.md` § 1 : « Produit avec comptes ou données personnelles : le socle de
  `compliance-by-design` fait partie de l'incrément 1 » ; § 3, tableau des artefacts : ligne « Conformité → tables
  et tâches du socle + tests, pas un document de politique ».
- `core/agents/ceng-security.md`, phase `security-review` : vérifier le socle sur le diff (lecture journalisée,
  donnée classée, règle de conservation pour toute nouvelle table).

**Critères d'acceptation.** La skill est installée sur un projet vide ; `reference.sql` s'exécute sans erreur sur
un PostgreSQL vierge muni d'une table `users(id uuid primary key)`.

**Tests.** `test/assets.test.ts` : skill sélectionnée pour tout profil ; taille de `SKILL.md` bornée.
**À vérifier** : exécution réelle de `reference.sql` (Supabase local) avant de le livrer.

---

### G-2 — Manifeste de conformité

**Problème.** Aucune gate ne sait si le socle existe. Et il ne peut pas se détecter par des noms de tables : chaque
pile l'écrit autrement.

**Quoi.** `.ceng/brain/compliance.json` : pour chaque mécanisme, où il est réalisé et quel test le prouve — ou la
décision qui l'écarte.
```json
{ "C-04": { "status": "implemented", "files": ["supabase/migrations/0007_retention.sql"], "tests": ["supabase/tests/retention.sql"] },
  "C-02": { "status": "waived", "decision": "0012-pas-de-traceurs.md" },
  "C-08": { "status": "missing" } }
```

**Changement.**
- `src/domain/compliance.ts` : la liste des 14 mécanismes (identifiant, titre, test exigé ou non) et la règle
  d'applicabilité (domaines `auth`, `pii`, `accounts`, ou profil avec authentification détectée).
- `src/app/compliance.ts` : `checkCompliance(store)` — pour chaque mécanisme applicable : `implemented` exige que
  les fichiers et les tests cités **existent** ; `waived` exige que la décision existe et ne soit ni rejetée ni
  remplacée ; sinon `missing`.
- Commandes `ceng compliance status` (tableau), `ceng compliance set C-04 --files … --tests …`,
  `ceng compliance waive C-02 --decision <fichier>`. `waive` est une action à approbation humaine hors bypass
  (règle dans `src/domain/guardrails.ts`, comme `bypass-mode`).
- `src/app/gates.ts`, `runComplianceGate` : ajouter le résultat. Mécanisme manquant → `fail` pour les tâches du
  domaine `release` et dans `ceng ready` ; simple note sur les autres tâches (le socle se construit par incréments).
- `ceng task add` : les tâches du socle se créent en une commande, `ceng compliance plan` (une tâche par mécanisme
  manquant, domaines et critères d'acceptation préremplis à partir de la skill).
- Brief de session : « Conformité : 9 mécanismes sur 14 en place, 1 écarté, 4 manquants ».

**À ne pas toucher.** Le contrôle des licences existant.

**Critères d'acceptation.** Projet avec authentification et manifeste vide : `ceng ready` échoue en listant les
14 mécanismes. Un mécanisme déclaré avec un fichier de test inexistant reste `missing`. Un `waive` sans décision est refusé.

**Tests.** `test/compliance-manifest.test.ts`.

---

### G-3 — Classification des données dans la base elle-même

**Problème.** Une carte des données tenue dans un document diverge du schéma en quelques jours.

**Quoi.** Chaque colonne d'une table liée à une personne porte un commentaire SQL normalisé ; la carte est
**générée** depuis les migrations.
```sql
comment on column profiles.phone is 'pii:contact; purpose:account,delivery; basis:contract; retention:account+30d; processors:sms-provider';
comment on column orders.total_cents is 'pii:none';
```

**Changement.**
- `src/domain/data-map.ts` : analyse des `comment on column` et des `create table` des fichiers de migration ;
  vocabulaire fermé pour `pii` (`none`, `identity`, `contact`, `location`, `financial`, `health`, `content`,
  `technical`) et `basis` (`consent`, `contract`, `legal-obligation`, `legitimate-interest`).
- Nouvelle gate `privacy` (`builtin`, requise pour `kind: migration` et les domaines `database`, `pii`) : toute
  colonne ajoutée par la tâche dans une table qui référence la table des utilisateurs (directement ou par une clé
  étrangère) doit avoir son commentaire ; une catégorie autre que `none` exige `purpose`, `basis` et `retention` ;
  une `retention` citée doit correspondre à une règle de `retention_rules` (C-04).
- `ceng data-map` : écrit `.ceng/brain/data-map.md` (tableau par table) — c'est le registre des traitements, la
  source des déclarations des magasins et de la politique de confidentialité.
- Piles sans SQL écrit à la main (ORM) : même vocabulaire dans un fichier `data-map.json` tenu à côté du schéma ;
  la gate lit l'un ou l'autre.
- Complète P-12 de l'audit (contrôle à l'écriture) : règle d'avertissement `pii-unclassified`.

**Critères d'acceptation.** Migration ajoutant `profiles.birth_date` sans commentaire → gate en échec avec la ligne
à écrire. Avec `pii:identity` mais sans `retention` → échec. Avec tout → `pass`, et la colonne apparaît dans la carte.

**Tests.** `test/data-map.test.ts`.

---

### G-4 — Cadrage légal

**Changement** (texte, `core/skills/ceng-delivery/SKILL.md` § 1, et `bootstrap.md`).
- **Une invite, quatre questions** quand le produit a des comptes ou des données personnelles :
  1. pays où le produit est proposé ;
  2. public (grand public, professionnels, mineurs possibles) ;
  3. données sensibles traitées (santé, position précise, pièces d'identité, paiement) ;
  4. adresse de contact pour les droits et les alertes de sécurité.
- Tout le reste prend une valeur par défaut prudente, notée comme hypothèse : région d'hébergement la plus proche
  du public, délai de grâce de 30 jours avant purge d'un compte supprimé, journaux techniques 90 jours, journal
  d'audit 12 mois, ré-acceptation obligatoire pour tout changement de finalité ou de tiers.
- `ceng-researcher` lit **les textes officiels** des pays cités (loi sur la protection des données, autorité de
  contrôle, délai de notification d'une violation, durées légales de conservation des factures, âge du
  consentement numérique, règles de vente en ligne) et écrit `.ceng/brain/research/legal-<pays>.md`, avec les
  sources datées et ce qui diffère des valeurs par défaut. Même méthode que pour les règles Apple (`ios-release` § 0).
- Ce que la recherche ne permet pas de trancher devient une décision à impact fort dans la boîte de décisions,
  avec la recommandation « faire relire par un juriste avant la mise en production ».

---

### G-5 — Skill `security` renforcée

**Changement** (texte, `core/skills/security/SKILL.md`). Ajouter avant la liste OWASP une section
« Principes, quel que soit le framework » :

| Principe | Application concrète |
|---|---|
| Valider à la frontière | toute entrée externe passe par un schéma (types, bornes, formats) avant d'atteindre la logique ; rejet par défaut de ce qui n'est pas attendu |
| Autoriser à la donnée | la règle d'accès vit à la couche de données, refus par défaut ; l'écran et la route ne sont pas des contrôles |
| Moindre privilège | chaque clé, rôle de base et compte de service n'a que les droits de son usage ; la clé d'administration n'atteint jamais le client |
| Échouer fermé | une erreur, un délai dépassé ou une configuration absente refusent l'accès au lieu de l'ouvrir |
| Défauts sûrs | une nouvelle ressource est privée, un nouveau drapeau est éteint, un nouveau rôle n'a aucun droit |
| Idempotence des effets | paiement, envoi, création : une clé d'idempotence, pour qu'une répétition ne double rien |
| Limiter le débit | toute action coûteuse ou sensible a un plafond par compte et par adresse |
| Ne jamais faire confiance au client | prix, rôle, identifiant de propriétaire et quantité sont recalculés ou vérifiés côté serveur |
| Tracer | toute action sensible laisse une ligne d'audit (C-06) |
| Réduire la surface | pas de route, de port, de dépendance ni de permission « au cas où » |

Ajouter aussi :
- « Avant d'écrire : trois questions » — qui peut appeler ce code ? que se passe-t-il s'il ment sur chaque champ ?
  que voit-il si ça échoue ?
- la correspondance vers le socle : auth → C-09, administration → C-10, données personnelles → C-03 à C-06 ;
- la section « Secrets » mise en accord avec le bypass (elle dit encore « demander à l'humain de l'autoriser » sans
  exception, alors que `ceng-orchestrate/SKILL.md:136-140` l'autorise en bypass).

Recopier la ligne des trois questions dans le bloc « Sécurité dès l'écriture » des agents (`ceng-builder.md:36-41`
et ses copies).

---

### G-6 — Tests d'abus obligatoires

**Problème.** `security/SKILL.md` demande des « tests d'abus » pour les domaines sensibles ; aucune gate ne
vérifie qu'ils existent. Les tests écrits par un agent couvrent surtout le chemin heureux.

**Changement.**
- Nouvelle gate `abuse-tests` (`builtin`), requise quand la tâche touche un domaine de `SECURITY_SENSITIVE_DOMAINS`
  (`src/domain/policy.ts:7-9`) et modifie du code : parmi les fichiers de test modifiés par la tâche, au moins un
  cas dont le nom exprime un refus (`refuse`, `interdit`, `forbidden`, `denied`, `unauthorized`, `cannot`,
  `ne peut pas`, `rejette`, `rejects`).
- `ceng brief` : pour ces tâches, lister les cas attendus selon le domaine — `auth` / `authorization` : un
  utilisateur ne lit ni ne modifie la ressource d'un autre, un jeton expiré est refusé ; `payments` : montant
  modifié côté client refusé, double soumission sans double débit ; `upload` : type et taille refusés ;
  `webhooks` : signature invalide refusée ; `multi-tenant` : un client ne voit pas les données d'un autre.
- Contrôle volontairement simple (nom de test) : il garantit qu'au moins un cas négatif existe ; la revue de
  sécurité juge sa pertinence.

**Tests.** `test/abuse-gate.test.ts` : tâche `--domains auth` sans test de refus → échec ; avec → `pass` ;
tâche sans domaine sensible → gate absente.

---

### G-7 — Contrôles de sécurité dans `ceng ready`

Ajouter au contrôle « prêt pour la production » (fiche S-01 de `memoire-et-production.md`) :

| Contrôle | Vérification |
|---|---|
| Socle de conformité complet | `checkCompliance` (G-2) sans `missing` |
| Carte des données à jour | `ceng data-map` ne produit aucune colonne non classée (G-3) |
| Pages légales présentes | routes ou écrans de conditions, confidentialité et contact référencés dans le manifeste |
| Clé d'administration absente du code client | recherche des noms de clés serveur (`SERVICE_ROLE`, `SECRET_KEY`, `sb_secret_`) dans les dossiers du client |
| En-têtes de sécurité (web) | configuration de la politique de sécurité du contenu, du transport strict et du type de contenu présente |
| Mode débogage éteint | pas de drapeau de débogage ni d'origine `*` dans la configuration de production |
| Restauration de sauvegarde testée | une décision ou un rapport de moins de 90 jours l'atteste |
| Recherche légale faite | `.ceng/brain/research/legal-*.md` présent pour chaque pays du cadrage (G-4) |

---

## 4. Décisions à poser à l'humain

1. **Réponse automatique aux anomalies (C-07)** — suspendre automatiquement un compte suspect, ou seulement alerter ?
   - **A (recommandé)** : suspension automatique des jetons pour les comptes ordinaires, alerte seule pour les
     administrateurs (ne pas se bloquer soi-même).
   - **B** : alerte seule partout.
2. **Refus d'une nouvelle politique (C-01)** — que devient l'utilisateur qui refuse ?
   - **A (recommandé)** : accès limité à l'export et à la suppression de son compte.
   - **B** : accès en lecture seule à ses données existantes.
3. **Socle sur un prototype** — l'exiger dès le stade prototype ?
   - **A (recommandé)** : modèle de données et C-01, C-03, C-06 dès le prototype (coûteux à ajouter après coup) ;
     le reste exigé au passage en production.
   - **B** : tout dès le début.
   - **C** : rien avant le passage en production.
4. **Relecture juridique** — prévoir une relecture par un juriste avant la première mise en production ? Recommandé :
   oui, une fois, sur la politique de confidentialité, les conditions et la carte des données générée.
