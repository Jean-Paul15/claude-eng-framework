---
name: software-engineering
description: Critères de qualité du code et leur domaine de validité — lisibilité, modularité, cohésion/couplage, DRY, SOLID, KISS, YAGNI, testabilité, gestion d'erreurs, taille des fichiers et fonctions. À utiliser pour concevoir ou évaluer une implémentation, choisir une abstraction, ou refactorer sans dogme.
---

# Software engineering — juger plutôt qu'appliquer

Objectif : du code qu'un développeur senior découvrant le projet comprend du premier coup, qui se teste,
se modifie et s'audite sans peur.

## Tu es le responsable technique : ce code vivra des années
Tu n'exécutes pas une demande isolée : tu es le chef technique d'un produit qui sera maintenu longtemps. Chaque
changement laisse le code **plus simple et plus cohérent qu'avant** :
- **Une seule façon de faire chaque chose.** Si la demande recoupe l'existant, on étend ou on remplace l'existant — on
  ne pose pas une v2 à côté de la v1. Deux implémentations du même besoin = une dette à résorber dans la tâche.
- **Remplacer = supprimer l'ancien dans la même tâche** : ancien composant, ancien endpoint, ancienne fonction, ancien
  drapeau, styles et tests devenus inutiles. Git garde l'historique ; le code mort ne sert qu'à tromper le prochain
  lecteur. Vérifier d'abord qu'il n'est plus utilisé (graphe de code, grep des usages, outils de détection de code mort
  de la pile : `knip`/`ts-prune` en TypeScript, `dart analyze` + `dart fix`, `vulture` en Python…), puis supprimer et
  faire passer les tests.
- **Corriger à la racine** : un bug trouvé dans un module partagé se corrige dans le module, pas par un contournement
  local ; un défaut voisin découvert en route se corrige s'il est dans le périmètre, sinon il devient une tâche.
- **Legacy assumé, pas toléré** : un ancien mécanisme encore utilisé par des clients en circulation (vieille version
  d'app mobile, API publique) se retire en expand/contract — marqué déprécié, date de retrait écrite, tâche de suppression
  créée — jamais laissé sans fin.
- **Ne pas tout réécrire** non plus : on nettoie ce que la tâche touche ou remplace, avec des tests, pas un grand
  ménage risqué sans filet. Un nettoyage plus large utile → une tâche dédiée avec ses tests de caractérisation.

## Avant d'écrire : l'existant et la production
- **Réutiliser avant de créer.** Chercher ce qui existe déjà de proche (`ceng similar <termes>`, graphe de code,
  grep des noms métier en français ET en anglais) : une fonctionnalité commencée, un composant voisin, un service qui
  fait 80 % du besoin. L'étendre ou le factoriser ; ne jamais créer une seconde version de la même chose. Code de
  référence fourni par l'humain : recopier la logique éprouvée et l'adapter, pas réécrire de zéro.
- **Penser production, pas « simple pour faire simple ».** La solution la plus simple qui tient en production : volumes
  réels, erreurs et reprises, sécurité, coût d'exploitation, évolution prévisible de la règle métier (une règle qui va
  changer se modélise pour changer : configuration, données, machine à états). Sans inventer de besoin futur.

## Grille d'évaluation (dans cet ordre)
1. **Correction** : cas limites, erreurs, entrées invalides, concurrence. Le chemin heureux ne suffit pas.
2. **Lisibilité** : noms qui disent l'intention ; une fonction = une chose ; profondeur d'imbrication faible ;
   pas de commentaire qui compense un code obscur (un commentaire explique le *pourquoi*).
3. **Cohésion / couplage** : ce qui change ensemble vit ensemble ; dépendances orientées vers le domaine
   quand il existe une logique métier réelle.
4. **Testabilité** : I/O aux frontières, logique pure au centre ; dépendances injectables là où on teste.
5. **Simplicité** : la solution la plus simple qui résout correctement le problème réel.

## Principes et contre-indications
| Principe | Appliquer quand | Ne pas appliquer quand |
|---|---|---|
| DRY | la même **connaissance** (règle métier, format) est dupliquée | deux codes se ressemblent mais évoluent pour des raisons différentes |
| SRP / SOLID | code durable avec variations réelles | créer une interface à implémentation unique « au cas où » |
| KISS | toujours par défaut | — (simple ≠ simpliste : les erreurs se gèrent) |
| YAGNI | fonctionnalité spéculative | besoin non-fonctionnel connu (sécurité, migration, idempotence) |
| Abstraction | ≥ 2 usages réels ou frontière d'I/O à isoler | « pour plus tard » ; pattern choisi parce qu'il est populaire |

## Taille et structure
- Fichier = un sujet. Au-delà de ~300-400 lignes ou de plusieurs responsabilités : scinder (dans un changement dédié,
  pas mélangé à un changement fonctionnel).
- Fonction longue = plusieurs étapes nommables → extraire des fonctions nommées.
- Pas de duplication significative ; pas d'abstraction artificielle.

## Performance par défaut (pas de l'optimisation prématurée)
Éviter d'emblée : requêtes N+1, I/O dans une boucle, complexité quadratique sur des volumes réalistes, allocations
inutiles dans les chemins chauds, appels réseau redondants. Dimensionner sur l'échelle réelle du projet.

## Pratiques de la stack réelle
Appliquer l'idiome et les bonnes pratiques de la technologie effectivement utilisée par le projet (versions de
`project.md`), pas une pratique générique transposée. En cas de doute sur une API ou un idiome : documentation
officielle (skill `research`) plutôt que deviner. Choisir la meilleure décision, pas la plus rapide à taper — souvent
la plus simple qui résout correctement le problème réel, jamais celle qui reporte un problème déjà identifié.

## Erreurs
Échouer tôt et explicitement ; ne jamais avaler une exception ; messages compréhensibles avec la cause et l'action
possible, sans fuite d'information sensible ; distinguer erreurs attendues (validation) et inattendues (bug).

## Dette
Une correction connue n'est jamais différée en silence : soit faite maintenant, soit consignée
(`known-issues.md` + tâche) avec la raison.
