# Sécurité, autonomie, légal et gouvernance

## Séparation AUTONOMOUS / HUMAN APPROVAL REQUIRED

| Classe | Exemples | Mécanisme |
|---|---|---|
| **Interdit** | `rm -rf /` ou `~`, `curl … \| sh`, lecture ou copie de fichiers de secrets (`.env`, clés, credentials), `printenv`, désactivation des garde-fous, écriture dans `.git/` ou dans un fichier de secrets | hook `PreToolUse` → `deny` + règles natives `deny` |
| **Approbation humaine** | push forcé, `reset --hard`, `clean -f`, `checkout -- .`, `branch -D`, réécriture d'historique, publication (npm/cargo/docker push), déploiement (vercel --prod, fly, firebase, gcloud, aws, serverless…), infra (terraform apply/destroy, kubectl, helm), opérations destructives en base (DROP, TRUNCATE, reset de migrations), actions sur la production, `sudo`, gestion de secrets, actions GitHub irréversibles ; modification de `.claude/settings*`, `.ceng/config.json`, LICENSE, CODEOWNERS, SECURITY.md ; CI et infra-as-code (sauf autonomie high) | hook `PreToolUse` → `ask` + règles natives `ask` |
| **Suppression récupérable** | `rm`, `rm -r`, `Remove-Item -Recurse`, `del`, `git rm` sur des fichiers du projet (y compris ceux que Claude vient de créer et qui ne servent plus) | hook : **instantané git automatique juste avant** (fichiers non suivis compris), puis suppression **sans demander**. Elle reste annulable avec `ceng rollback <CP> --apply`. L'humain est sollicité seulement si rien ne peut être sauvegardé : hors du projet ou racine, fichiers ignorés par git (ex. `.env`), fichiers du framework (`.ceng/brain`, `.claude/`…), cibles avec joker ou variable, projet sans git |
| **Autonome** | tout le reste : lecture, édition du code, tests, commits locaux, push sur une branche non protégée (hors autonomie supervisée), suppression de `node_modules`/`dist`/… | permissions normales |

**Comment l'humain approuve** : par l'invite de questions de Claude Code (« Approuver R-xxxx » / « Refuser R-xxxx »),
qui peut expirer, et non par une boîte de permission qui figerait la session. Le hook `PostToolUse` lit la réponse
réelle et crée une autorisation à usage unique, limitée à cette action exacte et valable 30 min. Claude ne peut pas
s'auto-approuver. Si l'invite expire sans réponse, la session bascule en mode sans humain : refus consignés dans
`pending-approvals.md`, aucune attente.

Ces catégories ne sont **jamais** assouplies par le niveau d'autonomie. Un agent ne peut pas desserrer ses propres
garde-fous : les fichiers de configuration des garde-fous sont eux-mêmes protégés.

**Limite assumée** : les hooks et règles analysent la commande, ce n'est pas un sandbox. Une commande obfusquée ou
un script qui ouvre lui-même un fichier peut passer. Pour une autonomie élevée, activer le
[sandbox de Claude Code](https://code.claude.com/docs/en/sandboxing), qui isole au niveau du système d'exploitation.
Les hooks sont *fail-open* (un bug du framework ne bloque pas la session) : les permissions natives restent la
première ligne de défense.

## Sécurité dans le cycle de développement

Profondeur proportionnée au risque :
- risque faible : garde-fous standards ;
- surface sensible : check-list OWASP Top 10:2025 (skill `security`) ;
- risque élevé : *threat model* (STRIDE léger, cas d'abus) → tests de sécurité → revue sécurité ;
- domaine critique : idem, avec Opus pour le threat model et la revue, plus une approbation humaine si requise.

Le scan de secrets (gate intégrée) et la redaction des journaux sont actifs en permanence.

## Légal et gouvernance (toujours actif)

- Skill `legal-governance` installée dans **tous** les projets.
- Découverte : licence du projet (fichier, package.json, pyproject, Cargo), NOTICE, CODEOWNERS, politique de
  confidentialité, code de conduite, CLA, signaux de données personnelles, d'analytics et d'IA.
- Gate `compliance` : licence absente, dépendances à copyleft fort incompatibles (approbation humaine), copyleft
  faible signalé, rappels RGPD (minimisation, base légale, conservation, sous-traitants) et IA (transparence, données
  envoyées).
- Domaine `licensing` → approbation humaine obligatoire.
- Traçabilité : ADR pour les décisions structurantes, dérogations de gate justifiées, journal d'événements, rapports
  par tâche.
- L'agent **détecte, documente et escalade** ; les décisions légales appartiennent à l'humain.

## Ce que le framework ne journalise pas

Contenu de fichiers, prompts complets (seulement leur longueur), valeurs de secrets (redaction systématique :
formats de clés connus, chaînes de connexion, affectations `*_SECRET=…`).
