---
name: architecture
description: Jugement architectural proportionné — structure de modules, frontières, monolithe modulaire vs services, couches, contrats, choix technologiques, ADR. À utiliser quand une décision est coûteuse à inverser, touche plusieurs modules, ou introduit une dépendance/technologie.
---

# Architecture

## Quand une décision est « architecturale »
Elle est coûteuse à inverser, traverse plusieurs modules, fixe un contrat (API, schéma, format, événement), ou
introduit une technologie. Ces décisions → réfléchir à des alternatives et écrire un ADR
(`node .ceng/runtime/cli.js decision add --title … --context … --decision … --consequences … --alternatives …`).

## Méthode (courte)
1. Exigences réelles : fonctionnelles, non-fonctionnelles chiffrées (volume, latence, disponibilité, coût,
   conformité), contraintes d'équipe. Pas d'exigence imaginée.
2. 2-3 options. Pour chacune : complexité ajoutée, risques, réversibilité, coût d'exploitation, adéquation à l'existant.
3. Choisir la plus simple qui satisfait les exigences ; noter ce qui ferait changer d'avis (déclencheurs).

## Heuristiques
- **Monolithe modulaire d'abord.** Services séparés seulement pour : équipes indépendantes, échelle très hétérogène,
  isolement de pannes ou de sécurité nécessaire.
- **Couches** (domaine / application / infrastructure) quand il y a une vraie logique métier ; un CRUD ou un script
  n'en a pas besoin. Le domaine n'importe jamais un détail d'I/O.
- **Contrats explicites et versionnés** aux frontières (types partagés, OpenAPI, schéma d'événements).
- **Respecter l'existant** : imiter les patterns du projet plutôt qu'en introduire un concurrent ; un changement
  de style se fait par décision explicite et migration progressive.
- **Données** : la base est souvent le meilleur garant des invariants (contraintes, transactions).
- **Dépendances** : chaque nouvelle dépendance doit justifier sa valeur (maintenance, taille, licence, sécurité).

## Revue d'architecture (phase `architecture-review`)
Vérifier : respect des invariants de `architecture.md`, sens des dépendances, contrats inchangés ou versionnés,
pas de couplage caché (état global, import croisé), cohérence avec les ADR. Décider sur la base des rapports et des
tests, sans relire chaque ligne.

## Mettre à jour le Brain
`.ceng/brain/architecture.md` : vue d'ensemble, invariants. Concis ; les détails vivent dans les ADR.
