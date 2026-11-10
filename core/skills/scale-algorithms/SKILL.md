---
name: scale-algorithms
description: Algorithmes et structures qui tiennent en production quand le volume explose — recherche de proximité (chauffeur, livreur, commerce le plus proche), matching, classement, recherche plein texte, déduplication, agrégats, limites de débit, files. Réduire le calcul par indexation, pré-calcul, approximation et découpage. À utiliser dès qu'un traitement dépend du nombre d'utilisateurs, d'objets ou d'événements.
---

# Algorithmes à l'échelle

Réflexe : **ne jamais comparer « chaque élément à tous les autres » en production.** La version naïve (parcourir toute
la table, calculer une distance pour chaque ligne, trier) est correcte et s'effondre au premier pic. On réduit
l'espace de recherche AVANT de calculer précisément.

## 1. Méthode (pour chaque cas, pas une recette unique)
1. **Taille réelle** : combien d'éléments maintenant, dans 12 mois, au pic ? Fréquence de la requête ? Latence visée ?
2. **Qu'est-ce qui suffit ?** Le meilleur exact, ou un bon résultat rapide (k candidats « assez proches ») ?
3. **Filtrer grossièrement, puis affiner** : index ou grille → quelques dizaines de candidats → calcul exact → décision.
4. **Déplacer le coût** : pré-calcul à l'écriture, calcul incrémental, lot en arrière-plan, cache.
5. **Borner** : rayon maximal, nombre de candidats, délai ; repli explicite quand rien n'est trouvé (élargir par paliers).
6. **Mesurer** à volume simulé réaliste (jeu de données généré) avant de livrer ; noter la complexité dans le rapport.

## 2. Proximité géographique (chauffeur, livreur, point de vente)
- **Index spatial en base** : PostGIS `geography` + index GiST, `ST_DWithin` (rayon, utilise l'index) puis tri KNN
  `ORDER BY geom <-> point LIMIT k` — jamais une distance haversine calculée en SQL sur toute la table.
- **Grille hexagonale ou geohash** (H3, S2, geohash) : chaque position porte sa cellule ; on cherche dans la cellule et
  ses voisines (k-ring), on élargit par anneaux si besoin. Idéal pour les positions qui bougent sans cesse.
- **Positions temps réel en mémoire** (Redis `GEOADD`/`GEOSEARCH`, ou table non journalisée) mises à jour à fréquence
  bornée (toutes les N secondes ou au-delà de X mètres), pas à chaque tick GPS.
- **Distance ≠ temps** : la plus proche à vol d'oiseau n'est pas la plus rapide. Pré-filtrer à vol d'oiseau, puis
  calculer un temps de trajet (matrice de routage) seulement pour les k meilleurs candidats.
- **Le plus proche n'est pas toujours le bon choix** : disponibilité, charge, équité entre chauffeurs, direction de
  déplacement, regroupement de commandes (batching), acceptation probable. Score pondéré sur les candidats, pas sur tous.
- **Dispatch** : affectation par fenêtres courtes (toutes les 2-5 s) qui résout plusieurs demandes ensemble
  (affectation gloutonne ou hongroise sur un petit lot) plutôt que « premier arrivé, plus proche » qui crée des trous.
- Verrou ou réservation atomique du candidat retenu (pas deux commandes pour le même livreur).

## 3. Autres cas fréquents
- **Recherche texte** : index plein texte (`tsvector` + GIN, trigrammes `pg_trgm` pour la tolérance aux fautes) ou moteur
  dédié au-delà ; jamais `LIKE '%…%'` sur une grosse table.
- **Fil, classement, « tendances »** : score pré-calculé et mis à jour incrémentalement ; pagination par curseur ;
  fan-out à l'écriture pour les petits comptes, à la lecture pour les très gros.
- **Recommandation / similarité** : embeddings + index vectoriel approximatif (HNSW, pgvector) ; filtrer d'abord par
  métadonnées.
- **Déduplication, appartenance** : clés naturelles uniques, hachage, filtre de Bloom pour des volumes massifs.
- **Agrégats et tableaux de bord** : tables d'agrégats par période mises à jour au fil de l'eau, pas un `GROUP BY` sur
  tout l'historique à chaque ouverture.
- **Limites de débit et quotas** : compteur à fenêtre glissante ou seau à jetons en mémoire partagée.
- **Travail lourd** : file d'attente + workers idempotents, reprise, priorité ; jamais dans la requête HTTP.
- **Notifications de masse** : envoi par lots, regroupement, file avec débit maîtrisé.

## 4. Coût
Chaque choix se justifie aussi en coût d'exploitation (CPU base, appels d'API de cartographie facturés à la requête,
egress, mémoire). Appels externes coûteux (routage, géocodage, IA) : cache, déduplication, appel seulement sur la
liste réduite de candidats.

## 5. Ne pas sur-construire
À 200 éléments, un tri en mémoire suffit. L'important est que la solution choisie ait un **chemin d'évolution** clair
(interface stable, index ajoutable, grille activable) quand le volume grandira — et que ce seuil soit écrit.
