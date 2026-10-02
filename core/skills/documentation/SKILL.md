---
name: documentation
description: Documentation utile et maintenue — README, guides, référence d'API, ADR, commentaires, changelog — écrite pour le lecteur qui en a besoin, au bon endroit. À utiliser quand une fonctionnalité change un comportement visible, une API, une procédure d'exploitation ou une décision d'architecture.
---

# Documentation

## Ce qui mérite d'être documenté
- Comment installer, lancer, tester (README) — vérifié en exécutant les commandes.
- Contrats publics (API, CLI, configuration, formats) — idéalement générés depuis le code ou le schéma.
- Décisions coûteuses à inverser → ADR (contexte, décision, conséquences, alternatives).
- Procédures d'exploitation (déploiement, rollback, migration, incident).
- Le **pourquoi** non évident dans le code (commentaire court près du code concerné).

## Ce qui ne le mérite pas
Paraphraser le code ; journal de ce qu'on a fait (c'est le rôle de git et des rapports) ; documentation spéculative.

## Règles
- Le bon public : utilisateur, contributeur, exploitant — un document par public.
- Exemples exécutables plutôt que prose ; garder à jour dans le **même** changement que le code.
- Doc existante du projet (`docs/`, ADR existants) : suivre sa structure et son ton.
- Diagrammes en texte (Mermaid) quand un schéma clarifie un flux.
- Gate `docs` : vérifier que la doc touchée par le changement est exacte (commandes, noms, options).
