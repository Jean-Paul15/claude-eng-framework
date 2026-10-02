# Agent Skills — conception et cycle de vie

Sources :
- https://code.claude.com/docs/en/skills (vérifiée 2026-10-02)
- https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- https://agentskills.io (spécification ouverte Agent Skills : champs `license`, `compatibility`)

## Faits vérifiés

- Emplacements : personnel `~/.claude/skills/<nom>/SKILL.md`, projet `.claude/skills/…`, plugin,
  imbriqué (monorepo), entreprise. Priorité en cas de conflit : entreprise > personnel > projet >
  intégré.
- Chargement en trois niveaux : (1) `name` + `description` toujours en contexte ; (2) corps de
  `SKILL.md` à l'invocation ; (3) fichiers annexes seulement s'ils sont lus.
- Frontmatter utile : `description` (+ `when_to_use`, 1 536 caractères au total), `disable-model-invocation`,
  `user-invocable`, `allowed-tools`, `model`, `effort`, `context: fork` + `agent`, `paths`
  (activation sur fichiers correspondants), `metadata` (ignoré par Claude Code → utilisable par le
  framework).
- Le contenu d'une skill invoquée **reste** en contexte ; il est ré-attaché après compaction.
- Bonnes pratiques officielles : SKILL.md < 500 lignes, instructions critiques en tête, descriptions
  avec les mots que l'utilisateur emploie, `disable-model-invocation` pour les skills à effets de bord.
- Une skill personnelle portant le même nom qu'une skill intégrée la remplace → éviter les noms
  `code-review`, `security-review`, `simplify`… (le framework utilise `code-reviewing`).

## Conclusions pour le framework

1. **Une skill = un domaine, une procédure, des heuristiques de décision.** Pas de cours magistral :
   « quand c'est pertinent », « comment décider », « procédure », « pièges ». Les références
   détaillées vont en annexes (chargées à la demande).
2. **Installation sélective** : le cœur ne copie que les skills pertinentes pour le profil détecté
   (ex. `frontend`, `accessibility`, `creative-director` seulement si une UI est détectée ;
   `database` seulement si une base est détectée). Moins de descriptions → contexte permanent réduit.
3. **Skills générées par projet** : la découverte identifie des besoins spécifiques (Stripe, Flutter,
   pipeline de données, Postgres…) et génère un *brouillon* de skill (`metadata.ceng-status: draft`)
   contenant ce qui est connu (versions, fichiers, commandes, risques) et les sources officielles à
   consulter. L'orchestrateur complète le brouillon par recherche lors du bootstrap cognitif.
4. **Métadonnées framework** dans `metadata` (`ceng-tier`, `ceng-status`, `ceng-source`) : invisible
   pour Claude Code, exploitable par `ceng skills` et `ceng upgrade`.
5. **Auto-amélioration contrôlée** : une observation isolée n'est jamais promue. Une leçon devient
   candidate à une skill quand elle est observée sur ≥ 3 tâches distinctes (seuil configurable) ou
   justifiée par une source primaire ; la promotion passe par la skill `skill-forge` qui exige une
   justification écrite et, selon le niveau d'autonomie, une validation humaine.
6. **Les trois skills créatives** (`creative-director`, `frontend-executor`, `quality-gate-auditor`)
   forment une chaîne : la direction produit des documents de référence (source de vérité) ; les
   exécutants n'inventent pas le design ; l'auditeur compare implémentation et référence et
   renvoie un rapport d'écarts classé aux exécutants au lieu de réécrire lui-même.
