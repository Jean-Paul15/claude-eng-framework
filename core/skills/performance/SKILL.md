---
name: performance
description: Ingénierie de performance — éviter d'emblée les anti-patterns connus, mesurer avant d'optimiser, budgets (Core Web Vitals, latence, mémoire), profilage, requêtes, cache, mobile. À utiliser pour un chemin chaud, un problème de lenteur, un traitement de gros volumes ou une gate performance.
---

# Performance

## Par défaut (dès la première écriture, pas une optimisation)
N+1 et I/O en boucle → chargement groupé ; complexité quadratique sur données réalistes → structure adaptée
(map/set, tri + parcours) ; appels réseau redondants → mutualiser ; gros volumes → streaming/pagination ;
re-rendus inutiles côté UI.

## Optimiser = mesurer
1. Définir la cible (SLO, budget : p95 < X ms, LCP ≤ 2,5 s, mémoire, coût).
2. Mesurer l'existant dans des conditions reproductibles (profileur, `EXPLAIN ANALYZE`, Lighthouse, benchmarks).
3. Changer **une** chose ; re-mesurer ; garder seulement ce qui améliore significativement.
4. Ajouter une protection contre la régression (benchmark en CI, budget Lighthouse) si le chemin est critique.

## Leviers par ordre habituel de rentabilité
Algorithme/requête → index → éviter le travail (cache avec invalidation claire, mémoïsation) → parallélisme/asynchronisme
→ micro-optimisations (rarement utiles).

## Dimensionner sur la réalité
Volume et trafic réellement attendus ; pas de cache distribué ni de sharding « au cas où ».
