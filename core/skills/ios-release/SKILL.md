---
name: ios-release
description: Préparer et publier une app mobile (Flutter en priorité) sur iOS, y compris sans Mac ni iPhone — pré-contrôles, signature et build Codemagic, TestFlight, fiche App Store Connect, confidentialité, relecture Apple et ses motifs de rejet, API App Store Connect, différences iOS/Android. À utiliser dès qu'on parle de build iOS, TestFlight, App Store Connect, Codemagic, Info.plist, rejet Apple, comptes de démonstration, App Privacy, captures ou icône iOS.
---

# iOS : du code à l'App Store (retours d'expérience réels)

Issu de vraies soumissions (projet izyGo, octobre 2026, Windows + Codemagic). À relire AVANT de lancer un build ou de
soumettre. Jamais de clé `.p8`, de mot de passe ou de jeton dans Git, un chat ou un e-mail : variables chiffrées de la CI.

## 1. Penser iOS dès le développement (pas à la soumission)
- **Pas d'inscription forcée (règle 5.1.1(v), rejet réel sur izyGo le 2026-11-02)** : tout ce qui n'a pas besoin d'un
  compte (parcourir, consulter, rechercher, simuler un prix) s'utilise sans compte ; la connexion n'est demandée qu'au
  moment où elle est indispensable (réserver, payer, sauvegarder, publier). Un écran de connexion en premier écran = rejet.
  À concevoir dès le départ (navigation invité, « connecte-toi pour continuer » au bon endroit), pas à la soumission.
- **Règles Apple qui changent la conception** (App Review Guidelines, vérifiées le 2026-11-10 — relire la page officielle
  avant chaque soumission, elle évolue) :
  | Règle | Exigence à concevoir dès le départ |
  |---|---|
  | 5.1.1(i) | lien vers la politique de confidentialité DANS l'app et dans App Store Connect |
  | 5.1.1(ii) | consentement avant toute collecte ; une fonction payante ne dépend jamais d'un accès aux données |
  | 5.1.1(iii) | ne demander que les données utiles au cœur de l'app ; sélecteurs système (photos, contacts) plutôt qu'un accès complet |
  | 5.1.1(iv) / 5.1.2 | un refus de permission ne bloque pas l'app : alternative prévue (saisie manuelle d'adresse si localisation refusée…) ; jamais exiger notifications, localisation ou suivi pour accéder à une fonction |
  | 5.1.2 | suivi publicitaire seulement après App Tracking Transparency |
  | 4.8 | connexion sociale principale → proposer aussi une connexion qui limite les données au nom et à l'e-mail et permet de masquer l'e-mail (Sign in with Apple le fait) |
  | 3.1.1 | contenu ou fonction numérique débloqué(e) dans l'app → achat in-app, avec bouton « Restaurer les achats » |
  | 3.1.2 | abonnement : ce qu'on obtient et le prix clairement affichés avant l'achat ; période ≥ 7 jours, disponible sur tous les appareils |
  | 4.5.4 | notifications jamais indispensables ; notifications promotionnelles seulement après accord explicite, désactivables dans l'app |
  | 1.2 | contenu publié par les utilisateurs → filtrage, signalement, blocage d'un utilisateur, contact publié |
  | 4.2 | plus qu'un site web reconditionné : de vraies fonctions natives, une vraie interface |
  | 4.2.3 | fonctionne seule ; gros téléchargement au premier lancement annoncé avec sa taille et validé par la personne |
  | 2.5.2 | pas de code téléchargé qui ajoute ou change des fonctions (mises à jour « à chaud » de logique interdites) |
  | 2.4.1 | l'app iPhone doit fonctionner correctement sur iPad (mise en page testée) |
  | 2.3.10 | aucun nom, icône ou image d'Android ou d'un autre magasin dans l'app ou la fiche |
  | 2.1 | aucun texte provisoire, aucun plantage, back-end en ligne pendant la relecture, compte ou mode démo fonctionnel |
  | 2.2 | pas de « bêta » ni « démo » dans l'app publiée (TestFlight pour ça) |
  | 1.4.1 | santé : allégations validées, rappel de consulter un professionnel |
  | 4.3 | une seule app par produit (pas une app par ville ou par client) |
  En travaillant, garder cette liste en tête et **chercher la règle à jour** dès qu'une fonction touche un sujet sensible
  (paiement, données, contenu des utilisateurs, santé, enfants, jeux d'argent, crypto, IA générative) — skill `research`.
- **Suppression de compte dans l'app** obligatoire (et révocation du jeton Sign in with Apple à la suppression).
- **Connexion tierce** (Google, Facebook…) → proposer aussi Sign in with Apple.
- **Achats** : un bien numérique consommé dans l'app passe par l'achat in-app ; un bien ou service consommé hors de
  l'app (billet, course, livraison) peut être payé autrement (règle 3.1.3(e)) — le dire dans les notes de relecture.
- **Fonctions qu'Apple réserve à certaines entités** (ex. vente de vols aériens, règle 5.1.1(ix)) : drapeau de
  fonctionnalité désactivé par défaut sur iOS.
- **Permissions** : demandées au moment du besoin, avec une phrase honnête ; refus géré (l'app reste utilisable).
- **Différences de comportement** : pas de bouton retour système (geste de bord et bouton de navigation visibles),
  zones sûres (encoche, Dynamic Island, barre d'accueil), clavier qui recouvre les champs, notifications (APNs,
  autorisation explicite, extension de notification), liens universels (`apple-app-site-association`), fond d'app
  suspendu plus tôt qu'Android (pas de tâche longue en arrière-plan sans API dédiée).
- **Captures et tests visuels** : tester les formats iPhone SE, iPhone 6,9", iPad si universelle (skill `visual-flow-testing`).

## 2. Pré-contrôles (avant chaque build — un script, pas une liste)
Un script de pré-contrôle dans le dépôt (ex. `app/tool/ios_preflight.py`, lancé aussi en CI) qui échoue vite — plus
rapide qu'un build Codemagic de 20 minutes :
- **Version** : `version: x.y.z+N` augmentée dans `pubspec.yaml` (le numéro de build monte toujours, iOS comme Android).
- **Swift Package Manager désactivé** si des plugins passent par CocoaPods : `flutter config --no-enable-swift-package-manager`
  dans l'étape de dépendances ET `flutter: config: enable-swift-package-manager: false` dans `pubspec.yaml` — sinon un
  SDK (ex. OneSignal) est embarqué deux fois et le build échoue.
- **Extension de notification (NSE)** dans le `Podfile` : même pod, même version, même sous-module que le plugin
  (ex. `pod 'OneSignalXCFramework', '5.5.0'` des deux côtés).
- **Chaînes de permission `Info.plist`** : toutes les clés dont un SDK a besoin, même si l'app n'utilise pas la fonction
  (un SDK de notifications lie la localisation → e-mail ITMS-90683 si `NSLocationWhenInUseUsageDescription` manque).
  Texte honnête (« l'app n'utilise pas votre position ; ce texte est exigé par le composant de notifications »).
- **Photos** : `image_picker` avec `requestFullMetadata: false` (PHPicker, pas d'accès à toute la photothèque) ;
  `NSPhotoLibraryUsageDescription` complet.
- **Icône** : PNG 1024×1024 sans transparence (`remove_alpha_ios: true` avec `flutter_launcher_icons`).
- **`PrivacyInfo.xcprivacy`** présent et cohérent avec les réponses de confidentialité d'App Store Connect.
- Secrets de build : fichier `Secrets.xcconfig` généré par la CI depuis ses variables, modèle `.template` versionné.

## 3. Codemagic (build signé sans Mac)
- Un workflow, déclenché sur `main` ou un tag ; versions de Flutter et Xcode épinglées ; signature automatique via la
  clé d'API App Store Connect (variables chiffrées).
- `submit_to_testflight: false` au début : sinon chaque build part en relecture TestFlight EXTERNE et l'étape finale
  échoue tant que les infos de test bêta ne sont pas remplies (le build, lui, est bon).
- Après l'envoi, traitement Apple de quelques minutes à une demi-heure ; un e-mail ITMS-xxxxx signale un problème de binaire.

## 4. TestFlight
- Testeur INTERNE : Apple ID ajouté dans App Store Connect > Utilisateurs, puis dans un groupe de test. « Ready To Test »
  sans invitation → vérifier l'adresse réellement utilisée dans Réglages > Apple ID de l'iPhone.
- Rôle donné à un testeur invité : le retirer après les tests.
- Sign in with Apple, push, liens universels : testés sur un VRAI iPhone, jamais déduits du code.

## 5. Fiche App Store Connect
- Captures iPhone 6,9" (obligatoires), iPad 13" si l'app est universelle — vrais écrans, vraies polices.
- Visuel d'en-tête 16:9 (5244×2950, PNG sans transparence, zone utile loin des bords).
- Confidentialité : chaque type de donnée collecté (finalité, lié à l'utilisateur, suivi oui/non), cohérent avec
  `PrivacyInfo.xcprivacy` (skill `legal-governance`).
- Disponibilité par pays ; statut « trader » (DSA) seulement pour la distribution dans l'UE.
- Notes de relecture en anglais + un compte de démonstration par rôle (mots de passe dans les notes si un seul champ).

## 6. Relecture Apple
- **2.1 Complétude** : avant de soumettre, chaque compte de démo se connecte, a des données visibles, et un mode test
  permet de finir un parcours sans argent réel. Un compte qui ne marche pas = rejet quasi certain.
- Délai habituel 24 à 48 h. Rejet → répondre dans le Centre de résolution ; pas de nouveau build si le problème est
  dans les données ou les comptes. Ne rien changer de ce que la relecture utilise jusqu'à la décision.

## 7. API App Store Connect (automatiser sans Mac)
- JWT ES256 (clé `.p8`, identifiant de clé, identifiant d'émetteur), valable ~15 min ; script hors dépôt s'il contient
  des chemins sensibles.
- Pièges : lire une disponibilité de territoire par identifiant → 403 (utiliser PATCH) ; liste des builds avec
  `fields` → 400 (utiliser `/v1/builds?filter[app]=…`) ; sous Git Bash, un chemin commençant par `/` est converti en
  chemin Windows (PowerShell, ou `MSYS_NO_PATHCONV=1`).
- Soumission : créer une `reviewSubmission`, y ajouter la version, la soumettre ; vérifier l'état par l'API
  (`WAITING_FOR_REVIEW` puis `IN_REVIEW`) plutôt que de le supposer.
- Captures : créer l'ensemble d'écrans, réserver l'envoi, envoyer les morceaux, valider avec la somme MD5.

## 8. Ordre conseillé
Pré-contrôle + tests → version augmentée → build Codemagic → e-mail ITMS vérifié → TestFlight interne sur un vrai
iPhone → fiche, confidentialité, notes et comptes vérifiés un par un → soumission (action à validation humaine sauf
bypass total) → suivi de l'état par l'API.
