---
name: ceng-delivery
description: Livrer un produit complet à partir d'un cahier des charges — cadrage en quelques questions puis validation, planification agile accélérée au rythme des agents, artefacts exécutables plutôt que documentation, réutilisation de code de référence, décisions pensées production (évolution, coûts), parallélisme multi-surfaces (web, mobile, backoffice, API), TDD et tests visuels du flux, gestion des limites du compte et des sessions. À utiliser quand l'humain donne un cahier des charges, un objectif produit ou dit « livre-moi ça ».
---

# Du cahier des charges à la livraison

L'humain donne le cahier des charges ; **tu prends les décisions, tu planifies, tu livres proprement**. Il vient
parler de temps en temps, il ne contrôle pas chaque étape. Ce qui suit est sa manière de réfléchir : applique-la.

## 0. La manière de réfléchir
- **Penser production dès la première ligne.** Pas « simple pour faire simple » : la solution la plus simple QUI TIENT
  en production — volumes réels, pannes, sécurité, coûts, évolution prévisible du métier. Une logique qui va évoluer
  (tarifs, statuts, rôles, règles métier) est modélisée pour évoluer (table de configuration, machine à états, règles
  en données) ; une logique stable reste simple. Pas d'abstraction pour un besoin qui n'existe pas.
- **Les bonnes pratiques éprouvées d'abord** : ce que font les produits sérieux du même domaine (rechercher quand on ne
  sait pas — skill `research`), pas une invention.
- **Code rapide et optimisé dès l'écriture** (complexité adaptée au volume réel, pas de N+1, pas de travail inutile) et
  **travail économe en jetons** (paquets `ceng brief`, exploration par `ceng-scout`, jamais relire ce qui est déjà lu,
  sorties longues résumées) — sans jamais sacrifier tests, sécurité ou qualité.
- **Les coûts font partie de la conception** : base (skill `database`), algorithmes (skill `scale-algorithms`), appels
  d'API payants, stockage, temps réel, IA. Une fonctionnalité qui multiplie la facture par 10 au premier pic est un bug.
- **Réutiliser avant de créer** : code de référence fourni par l'humain, existant du projet (`ceng similar`),
  bibliothèque reconnue. Recopier et adapter une logique éprouvée bat la réécrire de zéro.
- **Dire plutôt que documenter** : le livrable est ce qui s'exécute (voir § 3).
- **L'UX et le flux sont la vérité** : le produit est validé quand ses parcours capturés en images sont bons (skill
  `visual-flow-testing`) ET que la logique derrière est juste (tests, état réel en base).
- **Objectifs serrés** : on vise la livraison complète et propre, pas une maquette. Rendu haut de gamme, jamais basique ;
  mieux vaut fermer une fonction derrière un drapeau que livrer du médiocre.
- **Validation différée, jamais d'attente** : une décision qui revient à l'humain → tu prends la meilleure valeur par défaut,
  tu continues, et tu l'ajoutes aux décisions à confirmer (ADR provisoire : ce que tu as choisi, pourquoi, ce qui change
  s'il dit non). Il valide en bloc, plus tard, via l'invite. Une seule action demandée à la fois, dite simplement.
- **Montrer par vraies captures**, jamais par maquettes inventées.

## 1. Cadrage (une fois, court)
1. Lire le cahier des charges et tout code de référence indiqué. Lister : utilisateurs et rôles, parcours clés,
   surfaces (web, mobile, tablette, backoffice, API), données, intégrations (paiement, cartes, notifications, IA),
   contraintes (légales, données personnelles — skill `legal-governance`, délais, budget d'exploitation).
   **App mobile visée (iOS surtout) : les règles des magasins entrent AU CADRAGE, pas à la soumission.** Faire lire
   par `ceng-researcher` toutes les pages officielles listées dans la skill `ios-release` § 0 (synthèse
   `.ceng/brain/research/apple-rules.md`, appliquée sans exception), puis la skill `ios-release` § 1 et l'appliquer au plan et aux écrans : navigation sans compte jusqu'au moment où il est
   indispensable (5.1.1(v), rejet réel), suppression de compte, achats in-app ou paiement externe selon la nature du bien,
   permissions refusables avec alternative, connexion respectueuse si connexion sociale, contenu des utilisateurs
   modérable. Côté Android : règles Google Play équivalentes (données, permissions sensibles, suppression de compte).
   Pendant le travail, toute fonction sensible (paiement, données, santé, enfants, IA, contenu publié) → vérifier la
   règle à jour du magasin (skill `research`).
   **Cahier des charges en PDF (ou images, maquettes, captures)** — le lire en entier, une fois, sans le relire ensuite :
   - Pages lues par lots (outil Read avec `pages`, 20 pages au plus par lecture) : texte ET images de chaque page sont vus
     (maquettes, schémas, tableaux, captures). Gros document → découpé entre plusieurs `ceng-researcher` (un lot de pages
     chacun), qui renvoient chacun une synthèse.
   - Images extraites en pleine résolution dans `docs/spec/assets/` (PyMuPDF : `page.get_images()` + `extract_image`, ou
     `pdfimages -png` ; `pdftoppm -r 150` pour une page entière), nommées `p<page>-<n>-<sujet>.png`.
   - Synthèse unique `.ceng/brain/spec.md` : une section par partie du cahier, exigences numérotées (EX-001…) avec la page
     source, et pour chaque maquette son image, l'écran qu'elle décrit et ce qui est imposé (contenu, ordre, style) ou
     seulement indicatif. C'est elle que lisent l'orchestrateur et les briefs (`--ref docs/spec/assets/...`), jamais le PDF.
   - Les maquettes deviennent des références du test visuel : la capture livrée est relue à côté de l'image du cahier ;
     écart volontaire (meilleure UX, règle d'un magasin) → noté dans la synthèse avec la raison.
   - Chaque exigence est tracée jusqu'à une tâche et un test (« EX-014 → T-0031 ») ; la livraison finale liste celles couvertes.
2. Repérer **seulement les vrais trous** : ce qui change l'architecture, le modèle de données, la facture ou le légal.
   Le reste se décide (bonne pratique du domaine) et se note comme hypothèse.
3. **Une seule invite** (`AskUserQuestion`, 1 à 4 questions groupées, recommandation en premier) si le cahier est
   imprécis sur un point à impact fort. Aucun trou → ne rien demander.
4. Présenter le **plan de livraison** en une invite de validation : périmètre par incrément, choix structurants (pile,
   hébergement, modèle de données en une phrase), ce qui est hypothèse. « Valider (Recommandé) / Ajuster ». Humain
   absent → la recommandation est la décision provisoire (ADR provisoire), on avance.

## 2. Planifier au rythme des agents (agile accéléré)
Les estimations humaines ne valent plus : ce qui prenait 2 mois à une équipe se livre en jours, parfois en un jour.
- **Unité = tâche vérifiable** (1 livrable, ses tests, ses captures), pas des jours-homme. Un incrément = une tranche
  verticale utilisable (données + API + écran + tests), jamais « toute la base, puis tout le back, puis tout le front ».
- **Incrément 1 en quelques heures** : le parcours principal de bout en bout, en vrai (pas de maquette), déjà beau.
- Ensuite des incréments courts, chacun démontrable (captures du flux dans le rapport). Rétro express après chaque
  incrément : `ceng adapt`, leçons (`ceng learn add`), plan ajusté.
- Graphe de tâches dense et exact (`ceng task add` avec `--files`, `--deps`, `--accept`, `--interfaces`) : c'est lui qui
  permet le parallélisme et la reprise.
- Ne pas s'arrêter à la première tâche verte : enchaîner jusqu'à l'objectif (le hook Stop relance tant qu'il reste du
  travail faisable).

## 3. Artefacts exécutables, pas documents
| Besoin | Livrer directement | Pas |
|---|---|---|
| Modèle de données | migration SQL (tables, contraintes, index, politiques RLS, seed de test) | un document qui décrit les tables |
| Contrat d'API | schéma OpenAPI / types partagés / schéma de validation (zod, pydantic) + tests de contrat | une page wiki d'endpoints |
| Règles métier | code + tests qui les énoncent (noms de tests = règles) | une liste de règles en prose |
| Design | module de design system (tokens, thème, composants) | un document de direction |
| Configuration | fichiers de config versionnés, `.env.example` commenté | un guide d'installation long |
| Décision | ADR de quelques lignes (`ceng decision add`) | un document de conception |
**Diagrammes UML obligatoires quand ils sont pertinents** (gate `diagrams`, vérifiée à chaque tâche concernée : présent
dans un fichier modifié par la tâche, sinon échec) — déclenchés par les domaines de la tâche :
| Domaine de la tâche (`--domains`) | Diagramme Mermaid exigé |
|---|---|
| `lifecycle` (entité à 3 statuts ou plus : commande, course, paiement, abonnement) | **états** — `stateDiagram-v2` |
| `integration`, `webhooks`, `oauth`, `payments`, `dispatch` (échange entre systèmes) | **séquence** — `sequenceDiagram` |
| `journey` (parcours utilisateur clé, processus métier à étapes) | **activité** — `flowchart` |
| `multi-surface` / `architecture` (cadrage d'un projet web + mobile + backoffice + API) | **déploiement** — `architecture-beta`, C4 ou `flowchart` dans un fichier d'architecture |
Rangement : `docs/diagrams/<sujet>.md` (bloc ```mermaid) ou à côté du code ; première ligne : ce qu'il reflète (fichiers,
symboles). Diagramme existant toujours exact après la tâche → `ceng gate record <id> diagrams pass --note "toujours exact : …"`.
Jamais : classes, objets, composants, paquetages, cas d'utilisation, communication, timing (le code, le SQL et les contrats
les remplacent). **Diagrammes : seulement quand ils portent le flux** et qu'on les fait vivre. Utiles : diagramme d'états (statuts d'une
commande, d'une course), séquence d'une intégration (paiement, webhook, dispatch), parcours utilisateur, architecture des
surfaces. En Mermaid dans `docs/` ou à côté du code, **mis à jour dans la même tâche** que le code qu'ils décrivent.
Un ER se génère depuis le schéma si besoin. Pas de diagramme UML de classes « pour la forme ».

## 4. Qui code (modèles)
- **Opus (toi, orchestrateur)** : cadrage, plan, contrats, arbitrages, revue des résultats. Tu codes toi-même seulement
  quand c'est plus court que déléguer (correction d'une ligne, contexte déjà chargé) ou quand la décision et son code
  sont indissociables (cœur d'architecture délicat → `ceng-principal`).
- **Sonnet** (`ceng-builder`, `ceng-engineer`, `ceng-frontend-executor`, `ceng-tester`) : l'essentiel de l'implémentation.
- **Haiku** (`ceng-scout`) : exploration, digestion de logs et de sorties longues.
- **Chaque agent reçoit uniquement sa portion** : `ceng brief <id> [--ref fichier]…` produit le paquet (fichiers à toucher,
  références à recopier, existant à réutiliser, décisions, critères). Pas d'historique, pas « tout le dépôt ». Le
  worker ne relit pas ce que tu as lu : tu lui donnes les chemins exacts et, si utile, les lignes.

## 5. Plusieurs surfaces en parallèle (web, mobile, tablette, backoffice, API)
1. **Contrat d'abord** (tâche bloquante courte) : schéma de données SQL + contrat d'API (OpenAPI/types partagés) +
   design system commun (tokens partagés web/mobile quand c'est possible). Figé (`--interfaces`).
2. **Mocks issus du contrat** : chaque front avance contre un serveur simulé généré du contrat, sans attendre l'API.
3. **Une piste par surface**, fichiers disjoints, worktrees si besoin (`ceng plan` le décide) : API · web · mobile ·
   backoffice. Au plus 3-4 agents qui écrivent en même temps.
4. Intégration à chaque incrément : tests de contrat des deux côtés, parcours bout en bout capturés sur chaque surface.
5. Backoffice : mêmes principes UX (skill `ux-principles`), densité plus forte, actions en masse, journal d'audit,
   rôles et permissions dès le départ.

## 6. Qualité sans ralentir
- **TDD** sur la logique (règles métier, calculs, états, permissions) : test d'abord (skill `tdd`). L'UI : scénario de
  parcours écrit d'abord, captures ensuite.
- Sécurité dès l'écriture (skill `security`), gates automatiques (`ceng gate run`) ; revue ciblée sur le risque.
- Aller vite sans casser : petites tâches vérifiables, checkpoints, commits logiques, rollback possible — c'est ce
  filet qui permet de ne pas demander la permission.

## 7. Sessions et limites du compte
- **Contexte** : ta conversation reste petite (rapports courts, Brain sur disque). Signes d'une session trop chargée :
  une compaction déjà faite, beaucoup de fichiers lus dans la conversation principale, un nouveau chantier sans lien.
  Alors : checkpoint volontaire (`--done`, `--next` précis), puis nouvelle session qui reprend depuis le Brain
  (`ceng run --resume`, ou une nouvelle session Claude Code dans le même dossier — elle relit le brief automatiquement).
  Pour plusieurs sessions en parallèle : skill `ceng-relay`.
- **Limites d'usage** (fenêtre de 5 h, plafond hebdomadaire) : Opus pour décider, Sonnet pour produire, Haiku pour lire ;
  effort adapté à la tâche (`effort` de la route) ; pas d'exploration large ; sorties volumineuses digérées par
  `ceng-scout`. Limite atteinte : le hook StopFailure consigne l'état, le checkpoint permet de reprendre exactement là ;
  en mode nuit, `ceng run --unattended` reprend après l'attente.
- **Ne jamais bâcler pour économiser** : l'économie se mesure sur la livraison entière (un bug en production coûte plus
  que le test qui l'aurait évité).

## 8. Fin de livraison
Parcours principaux validés en images sur toutes les surfaces et largeurs, gates vertes, migrations rejouables,
`.env.example` à jour, README court (lancer, tester, déployer), décisions en ADR, rapport final à l'humain : ce qui est
livré, hypothèses prises, décisions à confirmer (via l'invite), suite proposée.
