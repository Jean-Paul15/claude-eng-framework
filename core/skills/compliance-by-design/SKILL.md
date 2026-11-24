---
name: compliance-by-design
description: Socle obligatoire de tout produit avec comptes ou données personnelles — politiques versionnées et ré-acceptation, consentement par finalité, carte des données, durées de conservation et nettoyage automatique, export et suppression de compte, journal d'audit, détection d'anomalies, réponse à incident, administration, isolation, tiers, sauvegardes. À utiliser dès le cadrage et le modèle de données d'un produit avec comptes, données personnelles, ou quand `ceng compliance` signale un mécanisme manquant.
---

# Socle de conformité — construit dans l'incrément 1, pas avant la mise en production

**C'est la base minimale, pas une liste figée ni exhaustive.** Les lois évoluent, les produits aussi : un nouveau pays, une nouvelle
catégorie de données, un nouveau tiers, une exigence d'un client ou d'un magasin, un incident → un mécanisme s'ajoute
(`ceng compliance add X-01 --title "…" --because "<loi ou exigence>"`, puis `compliance set X-01 --files … --tests …`), et `ceng ready`
l'exige comme les autres. Chaque nouvelle fonctionnalité se demande « quelle donnée, quelle finalité, quel tiers, quelle loi nouvelle ? »
avant d'être codée. La recherche légale (`research/legal-<pays>.md`) se relit au moins une fois par an (contrôle `legal-fresh`).

L'agent n'est pas juriste : il rend obligatoires des **mécanismes techniques** reconnus (RGPD et équivalents) ; la loi du pays est lue à
la source (`ceng-researcher`, § « Cadrage légal ») et une relecture par un juriste avant la première mise en production est recommandée.
**Déclenchement** : dès qu'il y a des comptes ou une donnée personnelle (nom, e-mail, téléphone, position, photo, identifiant d'appareil,
adresse IP rattachée à une personne). Un mécanisme ne s'écarte que par une décision tracée de l'humain. Chacun se réalise en SQL, ORM ou
service selon la pile ; `reference.sql` (PostgreSQL, **modèle non exécuté : à tester et adapter**) donne les tables et fonctions.

## Les 14 mécanismes (ce qu'il garantit · règles · test obligatoire)

**C-01 Politiques versionnées et ré-acceptation** (RGPD 7, 13). On sait quelle version de chaque document chaque utilisateur a acceptée,
quand et comment ; un changement important oblige à ré-accepter. Vérification **côté serveur** (garde d'accès de l'API, fonction
`needs_reacceptance`) — jamais l'écran seul. Écran : résumé des changements en langage simple, texte complet, « J'accepte », issue en cas
de refus (exporter ses données, supprimer son compte) ; jamais de case pré-cochée. Un texte publié ne change jamais : nouvelle version =
nouvelle ligne, avec empreinte. Changement mineur : information seule. Mobile : navigation sans compte conservée (Apple 5.1.1(v)) ;
acceptation à la création du compte et à la connexion suivante après un changement.
*Test : un utilisateur dont l'acceptation date d'une version antérieure est refusé par l'API tant qu'il n'a pas ré-accepté.*

**C-02 Consentement par finalité, retirable** (7(3)). Mesure d'audience, publicité, e-mails commerciaux, partage avec un tiers : un
consentement propre, par action positive, retirable aussi facilement, historisé (table en ajout seul). Aucun SDK tiers non indispensable
avant consentement. Écran « Confidentialité » : un interrupteur par finalité. Désinscription en un clic dans chaque e-mail commercial.

**C-03 Carte des données** (30). Pour chaque donnée : catégorie, finalité, base légale, durée, tiers. Elle vit dans la base
(commentaires de colonnes) et se génère : voir `ceng data-map`.

**C-04 Conservation et nettoyage automatique** (5(1)(e)). Table de règles (`retention_rules`) et journal d'exécution ; une tâche planifiée
les applique par **lots bornés** (5 000 lignes) ; `delete` ou `anonymize` (la ligne utile aux statistiques est gardée, anonymisée). Règles
minimales : sessions et jetons expirés, comptes supprimés après le délai de grâce, comptes jamais activés, journaux techniques, fichiers
orphelins, exports générés, brouillons abandonnés. Pièces sous obligation légale (factures) **exclues**, durée légale vérifiée pour le pays.
Sauvegardes : expiration écrite dans la décision d'hébergement. Exécution en échec ou absente depuis 48 h : alerte (C-07).
*Test : ligne périmée supprimée ou anonymisée, ligne récente intacte, pièce sous obligation légale intacte.*

**C-05 Droits des personnes** (12, 15, 17, 20). Depuis l'application : export JSON (tâche asynchrone, lien à durée limitée, titulaire
ré-authentifié) et suppression de compte (désactivation immédiate → délai de grâce → purge par C-04, qui suit la carte des données :
toutes les tables, les fichiers et les tiers — paiement, e-mail, mesure — avec la liste traitée journalisée). Rectification du profil.
Réponse sous un mois. *Test : après purge, aucune table de la carte ne contient l'identifiant.*

**C-06 Journal d'audit en ajout seul** (5(2), 32). Qui a fait quoi, quand, et **qui a lu quelles données** ; colonne `subject_user_id`
(la personne touchée) ; écritures sensibles journalisées par déclencheur ou couche de service ; lectures de données personnelles par un
administrateur ou un compte de service journalisées avec un motif ; identifiants seulement, jamais de secret ni de contenu ; personne ne
peut modifier ni effacer (révocation des droits) ; durée = règle de C-04.

**C-07 Détection d'anomalies.** Requêtes planifiées sur le journal et les tables d'authentification, seuils de départ en **données**
(table de configuration, réglés sur l'usage réel) : un compte lit les données de plus de 200 personnes distinctes en 1 h (alerte, suspension
des jetons si non administrateur) · 10 échecs de connexion en 10 min (blocage croissant) · 20 refus d'accès en 10 min (limitation de
débit) · 3 exports en 1 h (le suivant en attente) · tout changement de rôle (alerte immédiate) · connexion administrateur depuis un
appareil ou un pays nouveau (nouvelle vérification) · nettoyage ou sauvegarde en échec · suppressions à 10 fois la moyenne sur 7 jours.
Table `security_alerts`, canal vers le propriétaire (e-mail ou webhook, choisi au cadrage), limitation de débit sur authentification,
export, recherche, paiement. *Test par signal : un scénario qui dépasse le seuil crée l'alerte.*

**C-08 Réponse à incident** (33 : 72 h à l'autorité ; 34 : information des personnes). Fonction `affected_subjects(acteur | table |
fenêtre)` → personnes, catégories (carte C-03), période. Registre `security_incidents` obligatoire même sans notification (33(5)).
Leviers testés : révoquer toutes les sessions (ou celles d'un compte), suspendre un compte, lecture seule globale, rotation des clés.
Fiche `docs/security/incident.md` (une page : qui prévenir, ordre, leviers, compte à rebours, modèles de message).
*Test : après des lectures simulées par un compte, `affected_subjects` renvoie exactement les personnes lues.*

**C-09 Authentification et sessions.** Fournisseur d'identité reconnu plutôt que code maison ; expiration et rotation des jetons,
révocation côté serveur ; mêmes messages et délais que le compte existe ou non ; refus des mots de passe compromis ; double
authentification obligatoire pour les administrateurs.

**C-10 Administration et moindre privilège.** Rôles distincts (support, finance, technique), aucun compte partagé, accès aux données
sensibles avec motif obligatoire et journalisé (« bris de glace »), actions en masse confirmées, revue trimestrielle des comptes privilégiés.

**C-11 Isolation des données.** Refus par défaut à la couche de données (politiques de lignes, ou filtre obligatoire de la couche d'accès) ;
l'autorisation ne repose jamais sur l'écran. Multi-clients : test d'isolation entre deux clients pour chaque table.

**C-12 Tiers et transferts.** Registre des sous-traitants (`.ceng/brain/processors.md` : service, données reçues, finalité, pays,
contrat signé ?) ; tout nouveau tiers = décision de l'humain ; région d'hébergement choisie au cadrage ; fonction d'IA : aucune donnée
personnelle envoyée sans base légale, non-entraînement activé.

**C-13 Chiffrement, secrets, sauvegardes.** Transit partout ; colonnes très sensibles chiffrées au repos (ou laissées au prestataire :
carte bancaire, pièce d'identité) ; secrets hors du code avec procédure de rotation écrite ; sauvegardes chiffrées et **restauration testée**.

**C-14 Journaux et suivi d'erreurs sans données personnelles.** Filtre central qui masque e-mails, téléphones, jetons, corps de requêtes ;
suivi d'erreurs configuré pour ne pas envoyer les données d'utilisateur ; test qui prouve qu'un e-mail passé dans une erreur n'apparaît pas.

## Autres obligations à ne pas oublier
Pages légales accessibles sans compte (conditions, confidentialité, mentions de l'éditeur, contact pour les droits ; vente en ligne :
conditions de vente, prix toutes taxes, rétractation) · bandeau de consentement avec « Refuser » aussi visible qu'« Accepter » ·
déclarations des magasins cohérentes avec la carte (étiquettes de confidentialité Apple, suivi, formulaire de sécurité Google Play) ·
mineurs (âge minimum, accord parental) · analyse d'impact (35) à proposer pour suivi à grande échelle, profilage ou données sensibles ·
`security.txt` et contact de signalement · fichiers téléversés (type et taille vérifiés côté serveur, hors racine servie, noms régénérés) ·
accessibilité (obligation légale dans de nombreux pays).

## Cadrage légal (une invite, quatre questions)
1. pays où le produit est proposé ; 2. public (grand public, professionnels, mineurs possibles) ; 3. données sensibles (santé, position
précise, pièces d'identité, paiement) ; 4. contact pour les droits et les alertes. Le reste prend une valeur prudente notée en hypothèse :
hébergement proche du public, délai de grâce 30 j, journaux techniques 90 j, journal d'audit 12 mois, ré-acceptation pour tout changement de
finalité ou de tiers. `ceng-researcher` lit les textes officiels des pays cités (loi, autorité, délai de notification, durées légales,
âge du consentement numérique, vente en ligne) → `.ceng/brain/research/legal-<pays>.md`, sources datées. Ce qui ne se tranche pas devient
une décision à impact fort pour l'humain, avec la recommandation d'une relecture par un juriste.

## Dans ceng
`ceng compliance status|add|set|waive` tient le manifeste `.ceng/brain/compliance.json` : un mécanisme est `implemented` (fichiers et tests
qui existent), `waived` (décision de l'humain) ou `missing` ; `ceng ready` échoue tant qu'un mécanisme applicable manque.
`ceng data-map` génère la carte des données depuis les migrations ; la gate `privacy` exige un commentaire de classification sur toute
colonne personnelle ajoutée. Skills voisines : `security`, `legal-governance`, `database`, `dependencies`.
