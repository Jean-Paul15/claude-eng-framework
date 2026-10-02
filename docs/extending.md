# Étendre le framework

Tout ajout passe par un test (`npm test`).

## Ajouter une skill au cœur
1. `core/skills/<nom>/SKILL.md` (+ annexes) : description qui dit **quand** l'utiliser, procédure, heuristiques,
   pièges ; moins de 200 lignes.
2. Ajouter une entrée dans `SKILLS` (`src/generation/catalog.ts`) avec la règle `when(profile)` et le `why`.
3. Test de sélection dans `test/discovery.test.ts`.

## Ajouter une skill projet générée
Ajouter un objet dans `core/project-skills.json` (`name`, `description`, `match` sur services, frameworks, databases
ou projectTypes, `focus`, `checklist`, `pitfalls`, `docs`, `research`). Aucun code à modifier.

## Ajouter un agent
`core/agents/<nom>.md` (frontmatter Claude Code : `model`, `effort`, `disallowedTools: Agent`, `skills`), qui se
termine par un bloc `CENG_REPORT` ; entrée dans `AGENTS` ; s'il doit être choisi par la route, modifier
`chooseImplementer` ou `buildPhases` (`src/domain/routing.ts`) et ajouter un test dans `test/routing.test.ts`.

## Ajouter un détecteur
Fonction pure `(ctx: ScanContext) => …` dans `src/discovery/` (stack, quality, platform ou domains), appelée depuis
`profileFromContext`. Ajouter un projet ou un fichier de démonstration dans `examples/` et un test.

## Ajouter une gate
1. Identifiant dans `GATE_IDS` et type dans `GATE_KINDS`.
2. Règle de sélection dans `selectGates` (`src/domain/gates.ts`).
3. Exécution : une commande (clé dans `Commands` et détection dans `detectCommands`) ou une gate intégrée dans
   `runGates`.

## Ajouter une règle de garde-fou
`FORBIDDEN` ou `APPROVAL` dans `src/domain/guardrails.ts`, avec un test positif **et** un test de non-régression
(une commande légitime similaire doit rester autonome).

## Ajouter un hook
Gestionnaire dans `src/hooks/handlers.ts` (rapide, fail-open, sans contenu sensible journalisé) ; déclaration dans
`frameworkHooks()` (`src/generation/settings.ts`) ; test dans `test/lifecycle.test.ts` via `runtimeHook`.

## Faire évoluer la politique de routage
Les seuils sont dans `routing.ts` et `planner.ts`. Modifier un seuil revient à changer le comportement de tous les
projets : ajuster les tests de table, et préférer un ajustement par adaptation (`adapt`) quand le besoin est propre
à un projet.
