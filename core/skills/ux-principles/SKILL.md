---
name: ux-principles
description: Principes UX et visuels non négociables pour toute interface (web, mobile, tablette, backoffice) — révélation progressive, une action principale par écran, ce qu'on montre et quand, hiérarchie, espacements, élévation sobre, typographie choisie, responsive mobile/tablette obligatoire, refus du « look IA ». À appliquer AVANT de dessiner un écran et pour juger une capture.
---

# Principes UX — ce qu'on montre, quand, et comment

Le design se pousse loin **dès le premier écran** : un écran moyen livré « pour l'instant » ne sera jamais repris.
Mais pousser loin ne veut pas dire ajouter : la qualité vient de ce qu'on **retire**.

## 0. Les lignes rouges de l'humain (par défaut sur tout projet ; le projet peut les préciser)
- **Ce que la personne doit ressentir** : « je sais ce que je dois faire maintenant », « je vois mes progrès », « j'ai envie
  de continuer ». Jamais de culpabilité, de honte, de reproche ni de fausse urgence.
- **Un message principal et une action principale par écran** ; le reste derrière « Plus », « ⋮ » ou une feuille. On dit
  l'effet vécu en une phrase, pas une liste de fonctions. Une question à la fois ; une permission seulement au moment du besoin.
- **Zone du pouce** : actions principales en bas sur mobile. **Boutons fins, sobres et rares** — jamais de gros boutons
  partout ; on simplifie avant d'ajouter.
- **Interface calme, moments forts spectaculaires** : le « waouh » est réservé aux moments qui le méritent (succès,
  accueil, visuel signature), pas étalé sur chaque carte.
- **Les mots** : courts, simples, sans jargon ; pas de parenthèses ni de précisions en trop ; pas de tiret cadratin « — »
  dans l'interface ; jamais le nom d'un fournisseur technique (IA, paiement) quand le produit peut parler en son nom ;
  les textes parlent à la personne, ils ne commentent jamais nos règles de conception ; toutes les langues livrées ensemble.
- **Rien ne change en silence** : l'app ou l'IA propose, explique, attend un oui avant de modifier quelque chose d'important.
- **Aucun système parallèle** : réutiliser les composants, moteurs et mécanismes existants avant d'en créer un.
- **Haut de gamme, pas basique** : un rendu simpliste est refusé. **Mieux vaut fermer que livrer du médiocre** : une idée
  qui reste faible après quelques essais part derrière un drapeau fermé. Chaque élément a une place réfléchie : il apparaît
  quand il le faut, disparaît ensuite, et l'écran n'est jamais plus encombré qu'avant.

## 1. Avant de dessiner : la question de l'écran
Pour chaque écran, écris (dans ta tête ou en commentaire du composant racine) :
1. **Qui arrive ici, avec quelle intention ?** (un seul profil principal)
2. **L'action principale** — une seule, visuellement dominante. Les actions secondaires sont plus discrètes ;
   les actions rares vont dans un menu, un écran de détail ou un « plus ».
3. **Ce que l'utilisateur doit voir pour décider** — et rien de plus à ce moment-là.
Si tu ne sais pas répondre, l'écran n'est pas prêt à être codé.

## 2. Révélation progressive (progressive disclosure)
- Montrer d'abord l'essentiel ; le détail **à la demande** (déplier, écran suivant, panneau, survol desktop).
- Formulaires : demander le minimum pour avancer ; options avancées repliées ; étapes courtes quand le formulaire
  est long (un sujet par étape, progression visible) ; valeurs par défaut intelligentes plutôt que des questions.
- Onboarding : apprendre en faisant (état vide qui guide, aide contextuelle au moment du besoin), pas un carrousel
  de 5 écrans de texte.
- Paramètres et options : les 20 % utilisés 80 % du temps en premier, le reste groupé et replié.
- Tableaux et listes : 3 à 5 colonnes/infos qui servent la décision ; le reste dans le détail. Filtres avancés repliés.
- Backoffice : densité plus forte acceptée, mais même logique — vue d'ensemble → liste → détail → action.

## 3. Budget d'écran (anti-surcharge)
- Au plus **une** action primaire, **2-3** secondaires visibles. Plus → regrouper ou déplacer.
- Un écran = un sujet. Deux sujets → deux écrans, ou des onglets si l'utilisateur alterne vraiment.
- Pas de texte d'explication pour compenser une interface confuse : clarifier l'interface.
- Chaque élément doit justifier sa place : « si je l'enlève, qu'est-ce qui casse ? » — rien → on l'enlève.
- États pensés dès le début : vide (qui dit quoi faire), chargement (squelette à la forme du contenu), erreur (cause +
  action de reprise), succès (retour discret), hors ligne. Ce ne sont pas des finitions.

## 4. Hiérarchie, espacement, rythme
- **Échelle d'espacement unique** (base 4 ou 8 : 4, 8, 12, 16, 24, 32, 48, 64…), en tokens. Jamais de valeur magique.
- La proximité dit l'appartenance : plus d'espace **entre** les groupes qu'**à l'intérieur** (règle de Gestalt).
- La hiérarchie se fait d'abord par **taille, graisse, couleur et espace** — pas par des boîtes, des bordures et des ombres.
- Alignements nets sur une grille ; marges latérales cohérentes par breakpoint ; longueur de ligne de texte 45-75 caractères.

## 5. Élévation et ombres : sobriété
Défaut fréquent : ombres lourdes, cartes partout, tout « flotte ». Règles :
- **2 niveaux d'élévation au plus** dans l'interface courante (surface de base, surface surélevée) + 1 pour ce qui
  recouvre (menu, modale, toast). Tokens nommés, pas d'ombre ad hoc.
- Préférer une **séparation par la surface** (léger changement de fond) ou un **filet 1 px** à une ombre.
- Ombre = petite, douce, peu opaque (ex. `0 1px 2px rgb(0 0 0 / .06), 0 1px 1px rgb(0 0 0 / .04)`) ; jamais de grosse
  ombre floue colorée par défaut. Pas d'ombre ET de bordure ET de fond contrasté sur le même élément.
- Pas de carte dans une carte. Une liste n'a pas besoin que chaque ligne soit une carte.
- Rayons cohérents (1 à 3 valeurs en tokens), rayon intérieur = rayon extérieur − marge.

## 6. Éviter le « look IA » (générique, interchangeable)
Signes à refuser : dégradé violet-bleu, glassmorphism partout, emoji comme icônes, hero centré « Titre + sous-titre +
deux boutons » sur chaque page, trois cartes à icône identiques, Inter seul en 400/600 partout, ombres colorées,
badges et pastilles décoratifs, texte d'accroche creux (« Boostez votre productivité »).
À la place :
- **Une idée directrice propre au produit** (son métier, sa matière, son public) qui guide couleur, typo, mouvement.
- **Typographie choisie** : une paire (titres à caractère + texte très lisible) avec une échelle typographique nette
  (ratio 1,2-1,333). Pistes selon le ton (vérifier la licence — OFL/Google Fonts/Fontshare — skill `legal-governance`) :
  - éditorial / premium : Fraunces, Instrument Serif, Newsreader, Playfair Display (titres) + Inter Tight, Source Sans 3 ;
  - produit moderne / tech : Geist, Satoshi, General Sans, Manrope, Plus Jakarta Sans, Sora ;
  - chaleureux / grand public : DM Sans, Outfit, Nunito Sans, Figtree ;
  - données / backoffice : IBM Plex Sans + IBM Plex Mono, Geist Mono pour les chiffres (chiffres tabulaires).
  Charger seulement les graisses utilisées, `font-display: swap`, sous-ensemble si possible.
- Palette réduite : neutres travaillés (pas du gris pur), **une** couleur d'accent utilisée avec parcimonie pour l'action,
  couleurs sémantiques (succès, erreur, alerte) distinctes de l'accent. Contrastes AA vérifiés.
- Icônes d'une seule famille, même trait, même taille optique. Illustrations et images réelles plutôt que génériques.
- Microcopie concrète, dans la langue de l'utilisateur, verbes d'action sur les boutons (« Enregistrer le trajet », pas « Valider »).

## 7. Responsive : mobile ET tablette obligatoires
Chaque écran est conçu et vérifié à **3 largeurs au moins** : mobile (360-390), tablette (768-1024, portrait et
paysage), desktop (1280-1440). La tablette n'est pas « un mobile étiré » ni « un desktop serré » :
- mobile : une colonne, action principale à portée du pouce (bas d'écran), cibles ≥ 44 pt / 48 dp, pas de survol ;
- tablette : deux panneaux quand l'usage s'y prête (liste + détail), marges plus larges, grilles à 2-3 colonnes ;
- desktop : largeur de contenu bornée, panneaux latéraux, raccourcis clavier pour les usages intensifs.
Zones sûres (encoche, barre de gestes), clavier virtuel qui ne masque pas le champ actif, texte agrandi (200 %) sans casse.

## 7 bis. Règles des magasins qui sont aussi de la bonne UX (mobile)
Navigation sans compte jusqu'au moment où il est indispensable ; permission demandée au moment du besoin et refusable
sans bloquer ; notifications jamais indispensables ; suppression de compte accessible ; prix et contenu d'un abonnement
visibles avant l'achat. Détail et numéros de règles : skill `ios-release`.

## 8. Mouvement
Le mouvement explique (d'où vient un élément, où il va), il ne décore pas. Courtes durées (150-300 ms), courbes
nommées en tokens, `prefers-reduced-motion` avec une alternative pensée. Jamais d'animation qui retarde une action.

## 9. Vérification
Un écran n'est validé qu'après **capture et relecture image par image** du parcours (skill `visual-flow-testing`),
aux 3 largeurs, avec cette grille : action principale évidente en 3 s ? surcharge ? hiérarchie ? espacements réguliers ?
élévation sobre ? typographie et contrastes ? états vide/erreur/chargement ? débordements ou textes coupés ?
