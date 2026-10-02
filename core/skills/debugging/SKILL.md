---
name: debugging
description: Recherche méthodique de cause racine — reproduction, hypothèses, expériences discriminantes, bisection, correction de la cause et non du symptôme. À utiliser pour un bug, un test qui échoue, un comportement inattendu, une régression ou un test intermittent.
---

# Debugging — cause racine, pas symptôme

1. **Reproduire** de façon fiable et minimale (commande, entrée, environnement). Pas de reproduction = pas de
   correction prouvée ; si impossible, instrumenter (logs ciblés) et le consigner.
2. **Observer** : message exact, trace, données en entrée, ce qui a changé récemment (`git log`, dépendances, config).
   Lire le code réellement exécuté, pas celui qu'on croit exécuté.
3. **Hypothèses** : en lister plusieurs ; pour chacune, une expérience qui la **réfute** (pas qui la confirme).
4. **Réduire** : bisection (`git bisect`, désactivation de moitié du chemin), cas minimal.
5. **Corriger la cause** : se demander « pourquoi » jusqu'à la cause qui, corrigée, empêche toute la classe de bug.
   Chercher les autres occurrences du même défaut.
6. **Prouver** : test de régression rouge avant, vert après ; suite complète verte.

## Cas particuliers
- **Intermittent** : course, ordre, horloge, état partagé, ressource externe. Chercher l'état partagé et l'ordre ;
  augmenter les répétitions pour mesurer la fréquence avant/après.
- **« Ça marche chez moi »** : différences d'environnement (versions, variables, fuseau, locale, données).
- **Performance** : profiler/mesurer avant de supposer.

## Discipline
Une seule variable modifiée à la fois. Noter ce qui a été essayé et le résultat (utile pour l'escalade : après
2 approches infructueuses, escalader avec ce journal plutôt que tourner en rond).
