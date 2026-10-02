---
name: accessibility
description: Accessibilité par défaut (WCAG 2.2 AA, WAI-ARIA) — sémantique, clavier, focus, contrastes, alternatives textuelles, formulaires, mouvement réduit, lecteurs d'écran, cibles tactiles. À utiliser pour toute UI web ou mobile et pour la gate accessibility.
---

# Accessibility

## Check-list (gate `accessibility`)
- **Sémantique** : éléments natifs (`button`, `a`, `label`, titres hiérarchisés, landmarks) avant ARIA. ARIA seulement
  pour combler un manque, et correctement (rôle + état + nom accessible).
- **Clavier** : tout est atteignable et utilisable au clavier, ordre logique, pas de piège ; focus **visible** ;
  modales : focus piégé dedans puis restitué.
- **Contrastes** : 4,5:1 texte normal, 3:1 grand texte et composants d'interface.
- **Alternatives** : `alt` pertinent (vide si décoratif), sous-titres pour les vidéos.
- **Formulaires** : label associé, erreurs annoncées et reliées au champ (`aria-describedby`), pas d'information par la couleur seule.
- **Mouvement** : respecter `prefers-reduced-motion` avec une alternative pensée ; pas de clignotement > 3/s ;
  animations longues ou en boucle contrôlables.
- **Cibles tactiles** : ≥ 24×24 px CSS (WCAG 2.2), idéalement 44×44 sur mobile.
- **Contenu dynamique** : annonces via régions live pour les changements importants.

## Vérification
Automatique (axe-core, Lighthouse, `eslint-plugin-jsx-a11y`, linters Flutter) — attrape ~30-40 % des problèmes ;
puis manuelle rapide : parcours au clavier, zoom 200 %, lecteur d'écran sur le parcours critique.
L'accessibilité est aussi une obligation légale dans de nombreux contextes (voir `legal-governance`).
