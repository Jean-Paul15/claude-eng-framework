---
name: frontend
description: Ingénierie frontend (web et mobile) — composants, état, chargement et erreurs, formulaires, rendu et performance, responsive, design tokens, intégration d'API. À utiliser pour construire ou modifier une interface quand aucune direction créative spécifique ne s'applique (sinon frontend-executor).
---

# Frontend

Si `docs/CREATIVE_DIRECTION.md` existe, la skill `frontend-executor` prime : on n'invente pas le design.

## Composants
- Réutiliser les composants et tokens existants avant d'en créer ; un composant = une responsabilité.
- État au plus près de son usage ; état serveur via la solution de fetching du projet (cache, invalidation) plutôt
  que copié dans un store global.
- Tous les états sont conçus : chargement (squelette qui préfigure le contenu), vide, erreur (cause + action de reprise),
  succès, désactivé. Les repères de navigation ne disparaissent jamais pendant un chargement.

## Feedback (Nielsen)
< 100 ms : instantané (aucun indicateur) · ~1 s : état visuel immédiat (bouton actif, optimiste) · > 1 s : indicateur
explicite, squelette de préférence au spinner · > 10 s : progression et possibilité d'annuler.

## Cohérence et actions destructives
- Un même type d'interaction (chargement, erreur, confirmation, état vide) se comporte et se présente pareil partout :
  réutiliser le composant existant, ne pas le réinventer écran par écran.
- Confirmation explicite avant toute action destructive ou irréversible (avec ce qui sera perdu) ; préférer
  l'annulation possible (« annuler » pendant quelques secondes, corbeille) à la confirmation seule. Jamais de perte de
  données silencieuse.

## Formulaires
Validation côté client pour l'ergonomie **et** côté serveur pour la sécurité ; messages d'erreur près du champ,
explicites ; ne jamais perdre la saisie de l'utilisateur ; labels associés.

## Performance
Budgets Core Web Vitals (LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1) : dimensions réservées pour médias, images
optimisées, code splitting, éviter les re-rendus inutiles, animations sur `transform`/`opacity`.

## Accessibilité
Skill `accessibility` : HTML sémantique d'abord, clavier, focus visible, contrastes, `prefers-reduced-motion`.

## Sécurité
Pas de `dangerouslySetInnerHTML`/`v-html` sur des données non fiables ; pas de secret côté client ; jetons en cookies
httpOnly quand c'est possible.
