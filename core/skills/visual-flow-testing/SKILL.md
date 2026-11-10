---
name: visual-flow-testing
description: Test principal de toute interface — dérouler les vrais parcours utilisateur (scénarios), capturer chaque écran et chaque état en images, relire les images comme un designer et un utilisateur exigeant, corriger, recapturer jusqu'à validation. Web, mobile (Flutter, natif), tablette, backoffice. À utiliser pour valider toute tâche qui touche une UI, et avant toute livraison.
---

# Test du flux par images

Les tests unitaires disent que le code fait ce qu'il dit ; **les images disent si le produit est bon**. Pour une
interface, le test qui fait foi est le parcours réel, capturé et relu écran par écran. Une tâche UI n'est pas terminée
tant que son parcours n'a pas été vu.

## 1. Scénarios (écrits avant de coder l'écran — c'est le TDD de l'UX)
Fichier par parcours (ex. `test/flows/<parcours>.md` ou dans le test e2e lui-même) :
```
Parcours : commander un trajet
Persona : utilisateur pressé, mobile, une main
Étapes : ouvrir → saisir destination → choisir option → confirmer → suivre le chauffeur
Attendu à chaque étape : <ce qui doit être évident, l'action principale, le retour visuel>
États à forcer : vide · chargement lent · erreur réseau · hors ligne · données longues/extrêmes · permission refusée
Largeurs : 390 (mobile) · 820 (tablette portrait) · 1180 (tablette paysage) · 1440 (desktop)
```
Couvrir le chemin heureux ET les chemins de bord : retour arrière, double tap, rotation, texte agrandi, mode sombre,
langue la plus longue, premier lancement (aucune donnée) et compte bien rempli.

## 2. Outillage — des captures qui disent la vérité
Méthode éprouvée (projet Steko, Flutter ; transposable) : **les tests de rendu écrivent les captures**. Un même test
sert deux fois : sans variable d'environnement c'est un garde-fou de mise en page exécuté en CI ; avec elle, il écrit
les PNG à relire.
- **Vraies polices** : en test, Flutter dessine des pavés « Ahem ». Charger toutes les polices du `FontManifest.json`
  (`FontLoader` par famille, une fois par isolat) avant les captures — sinon on juge une typographie qui n'existe pas.
- **Vraies ombres** : `debugDisableShadows = false` AVANT le premier rendu (les pinceaux d'ombre sont mis en cache),
  remis à `true` après — sinon les ombres floues sont rendues dures et trompent la revue d'élévation.
- **Appareils simulés** (`tester.view.physicalSize` + `devicePixelRatio = 2`, suffisant pour juger un trait de 1 dp) :
  petit Android 360×640, grand téléphone 412×915, mini 320×568, texte 200 % (`TextScaler.linear(2)`), mouvement réduit
  (`disableAnimations`), pliable 673×841, tablette 800×1280, paysage 780×360 ; clair ET sombre ; chaque langue livrée.
- **Capture de la vue racine** (feuilles, snackbars et voiles compris) via le calque racine → PNG nommé
  `<écran>_<état>_<appareil>` dans le dossier donné par une variable (ex. `SHOTS_DIR`) ; **jamais dans le dépôt**.
- **Gardes automatiques à chaque capture** : aucune exception de rendu (débordement), aucun texte coupé par son nombre
  de lignes (`RenderParagraph.didExceedMaxLines`), relevé des cibles tactiles < 48 dp dans un fichier de contrôle,
  règles du design system en test (widgets interdits hors composants, valeurs hors tokens).
- **Règles de rédaction en tests** (échouent le build) : glossaire du produit, pas de tiret cadratin ni de parenthèses
  superflues dans les textes visibles, aucun nom de fournisseur ou de marque interdit, toutes les langues présentes.
- **Mouvement** : bandes image par image — le même composant figé à t = 0, 80, 160… ms sur une planche — pour juger
  une animation « sur papier » ; avancer l'horloge par `pump()` puis `pump(durée)` (un seul `pump(durée)` ne fait que
  démarrer l'animation).
- **Planches d'états** : tous les états d'un composant (et toutes ses tailles) sur une seule image.
- Données réalistes injectées (overrides de providers / fixtures), jamais de « Lorem » : textes longs, montants, noms.
- **Limite à dire** : un rendu de test ne prouve pas le vrai téléphone (clavier, mise en veille, cache, permissions : un bug de production peut lui échapper). Pour les parcours critiques, compléter sur
  émulateur ou appareil : `adb exec-out screencap -p > shot.png` (actions : `adb shell input tap x y`, `input text`,
  `input keyevent 4` pour retour), simulateur iOS `xcrun simctl io booted screenshot shot.png`, ou Maestro
  (`takeScreenshot`) pour des scénarios déclaratifs.
- **Web** : Playwright — `page.setViewportSize` par largeur (390, 820, 1180, 1440), `page.screenshot({ fullPage: true })`
  par étape, `page.route` pour simuler lenteur et erreurs, `emulateMedia({ colorScheme, reducedMotion })`,
  `document.fonts.ready` attendu avant capture, puis `toHaveScreenshot` pour la non-régression des écrans validés.
  Sans Playwright : le navigateur intégré (preview) et ses captures.
- Rangement : `<SHOTS_DIR>/<parcours>/<NN-etape>_<appareil>.png` ; seuls les goldens validés sont versionnés.

## 3. Relire chaque image (grille — skill `ux-principles`)
Regarder vraiment l'image (outil de lecture d'image), pas seulement vérifier que la capture existe :
1. **Compréhension en 3 secondes** : où suis-je, que puis-je faire, quelle est l'action principale ?
2. **Surcharge** : trop d'éléments, d'actions, de texte ? Ce qui peut être révélé plus tard l'est-il ?
3. **Hiérarchie** : le plus important est-il le plus visible ? Tailles et graisses cohérentes ?
4. **Espacements** : réguliers, sur l'échelle ; groupes lisibles ; marges latérales cohérentes ?
5. **Élévation** : ombres sobres, pas de cartes empilées, pas d'effets lourds ?
6. **Typographie et couleurs** : police choisie bien chargée, contrastes, accent utilisé avec parcimonie ?
7. **Casse** : débordements, textes coupés ou tronqués sans raison, chevauchements, zones sûres, clavier qui masque ?
8. **États** : vide qui guide, chargement à la forme du contenu, erreur avec cause et reprise ?
9. **Cohérence** : même composant, même comportement que sur les autres écrans ?
10. **Logique** : la donnée affichée est-elle la bonne (montants, dates, statuts) ? Le parcours aboutit-il vraiment
    (vérifier l'état en base / l'API après l'action, pas seulement l'écran) ?

## 4. Boucle
**Tours de critique** : un agent critique (`ceng-quality-auditor`) relit les captures avec la grille et renvoie des écarts
classés ; l'exécutant corrige ; nouvelles captures (tour 2, tour 3…). L'humain valide en dernier, sur les vraies captures —
jamais sur des maquettes.
capture → relecture → liste d'écarts classés (bloquant / important / finition) → correction → recapture des seuls
écrans touchés → … Un écran est **validé** quand la grille ne relève plus rien de bloquant ni d'important aux
largeurs requises. Les écarts « finition » restants sont listés dans le rapport.

## 5. Économie
- Captures en résolution utile (largeur logique, facteur 1 ou 2), pas en 4K ; recadrer (zoom) sur la zone en doute.
- Lire d'abord les fichiers de contrôle texte (cibles tactiles, textes coupés) — peu coûteux — puis seulement les images utiles.
- Ne recapturer que les écrans modifiés ; garder les goldens validés pour la non-régression automatique.
- La relecture d'images volumineuses peut être déléguée (agent `ceng-quality-auditor` ou `ceng-tester`) avec la liste
  des captures et la grille — l'orchestrateur ne lit que la liste d'écarts.

## 6. Livrable
Dans le rapport de tâche : parcours couverts, largeurs, captures clés (chemins), écarts corrigés, écarts restants.
