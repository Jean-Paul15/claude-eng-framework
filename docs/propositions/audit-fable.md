# Audit de ceng — plan d'exécution

Audit en lecture seule du dépôt au commit `ba99331` (269 tests verts). Chaque constat a été vérifié dans le code ou
dans la documentation officielle de Claude Code (liens dans les fiches). Ce qui n'a pas pu être prouvé est marqué
**à vérifier**. Les numéros de ligne sont ceux du commit `ba99331`.

## 1. Résumé

1. Deux gates intégrées regardent le mauvais diff : après un commit, `secrets` analyse 0 fichier et passe (P-01).
2. Sur un projet créé depuis un cahier des charges, les agents créatifs ne sont pas installés alors que le routage y envoie les tâches (P-03).
3. Le « test principal » (gate `visual`) est purement déclaratif : rien ne prouve qu'une capture existe (P-05).
4. Le hook de fin de sous-agent ne voit pas un rapport remis par l'outil `SubagentHandback` et relance l'agent pour rien (P-02).
5. Après compaction, le brief ne cite qu'une tâche en cours et aucune décision ; `ceng brief` ne garde que les 12 dernières décisions (P-06, P-07).
6. Plusieurs consignes se contredisent ou sont inapplicables par un agent (P-04).
7. Chaque correction après revue relance un agent à froid, alors que `SendMessage` reprend le même agent avec son contexte (P-08).
8. Les migrations SQL, artefact central de la skill de livraison, sont exclues du contrôle de code (P-12).
9. Six décisions reviennent à l'humain (section 4).

## 2. Tableau des tâches

Coût : S = moins d'une heure d'agent, M = une à trois heures, L = plus.

| ID | Titre | Niveau | Gain | Coût | Risque |
|---|---|---|---|---|---|
| P-01 | Gates `secrets` et `diagrams` : diff depuis le début de la tâche | tout de suite | qualité, sécurité | M | faible |
| P-02 | Rapport remis par `SubagentHandback` reconnu | tout de suite | jetons, boucles | S | faible |
| P-03 | Agents et skills créatifs toujours installés | tout de suite | qualité UI, blocage évité | S | faible |
| P-04 | Contradictions entre agents et skills (texte) | tout de suite | qualité, jetons | S | nul |
| P-05 | Gate `visual` prouvée par des captures | tout de suite | qualité UI | M | moyen |
| P-06 | Brief de reprise complet et consignes de compaction | tout de suite | mémoire longue | M | faible |
| P-07 | `ceng brief` : décisions pertinentes, pas les 12 dernières | tout de suite | décisions oubliées | S | faible |
| P-08 | Reprendre le même sous-agent pour corriger (`SendMessage`) | tout de suite | jetons, vitesse | S | nul |
| P-09 | Contexte d'état injecté au démarrage du sous-agent | tout de suite | règles applicables | S | faible |
| P-10 | `route` cohérent avec le bypass et la direction créative | ensuite | clarté | S | nul |
| P-11 | Re-découverte automatique quand la pile change | ensuite | gates réelles | M | moyen |
| P-12 | Contrôle des migrations SQL (RLS, index, destruction) | ensuite | sécurité, coûts | M | moyen |
| P-13 | Traçabilité exigence → tâche (`--spec`) | ensuite | livraison complète | M | faible |
| P-14 | Skill d'orchestration sous 5 000 jetons | ensuite | mémoire après compaction | S | faible |
| P-15 | Un seul processus pour les hooks après écriture | ensuite | vitesse | S | faible |
| P-16 | Attribution agent → tâche sûre en parallèle | ensuite | conflits à tort | M | moyen |
| D-1 | Gate requise sans commande : bloquer ou non | à discuter | qualité | S | — |
| D-2 | Modèle de l'auditeur visuel | à discuter | coût | S | — |
| D-3 | Mémoire persistante des sous-agents | à discuter | apprentissage | S | — |
| D-4 | Worktrees : intégration des résultats | à discuter | parallélisme | M | — |
| D-5 | Mesure réelle des jetons par agent | à discuter | pilotage des coûts | M | — |
| D-6 | `omitClaudeMd` pour les agents de lecture | à discuter | jetons | S | — |

Règles communes à toutes les fiches, sauf mention contraire :
- ne pas changer les commandes CLI existantes, le format de `.ceng/config.json` ni les noms d'événements de hooks déjà installés ;
- tout champ ajouté à un type est optionnel (les `tasks.json` et `state.json` existants doivent rester lisibles) ;
- un texte modifié dans `core/` est recopié dans les projets par `ceng upgrade` : rien d'autre à faire ;
- tests en `node:test`, avec les helpers de `test/helpers.ts` (`sandbox`, `cli`, `json`, `runtimeHook`, `task`, `rm`).

## 3. Fiches

### P-01 — Gates `secrets` et `diagrams` : diff depuis le début de la tâche

**Problème.** `src/app/gates.ts:26-31` :
```ts
const head = git.head();
return head ? git.filesChangedSince(head) : git.changedFiles();
```
Le diff est pris contre le `HEAD` courant, donc seulement les fichiers non commités. Dès que le travail est commité
avant `ceng gate run` (worker qui commite, sous-agent en worktree, orchestrateur qui suit « commit logique »), la gate
`secrets` analyse 0 fichier et passe (`gates.ts:87`), et la gate `diagrams` déclare « non mis à jour » un diagramme
pourtant modifié par la tâche (`gates.ts:61`). Aucune tâche ne mémorise son commit de départ (`Attempt`,
`src/domain/types.ts:32-41`).

**Changement.**
- `src/domain/types.ts`, interface `Attempt` : ajouter `baseCommit?: string;` (commit `HEAD` au démarrage de la tentative).
- `src/app/tasks.ts`, `startTask` : dans l'objet poussé dans `t.attempts`, ajouter `...(base ? { baseCommit: base } : {})`
  avec `const base = new Git(store.paths.root).head();` calculé avant `store.updateTasks` (import de `Git` depuis
  `../infra/git.js`). Hors dépôt git, `head()` renvoie `undefined` : rien n'est écrit.
- `src/infra/git.ts` : ajouter `exists(commit: string): boolean` (`git cat-file -e <commit>^{commit}`, code 0).
- `src/app/gates.ts` :
  ```ts
  export function changedFiles(root: string, base?: string): string[] {
    const git = new Git(root);
    if (!git.isRepo()) return [];
    const from = base && git.exists(base) ? base : git.head();
    return from ? git.filesChangedSince(from) : git.changedFiles();
  }
  export const taskBase = (task: Task): string | undefined => task.attempts.find((a) => a.baseCommit)?.baseCommit;
  ```
  Dans `runGates` : `const files = changedFiles(root, taskBase(task));` une seule fois avant la boucle, puis
  `runSecretsGate(root, files)` et `runDiagramsGate(root, task, files)`. La première tentative qui porte un commit de
  base fait foi : une nouvelle tentative après échec couvre tout le travail de la tâche.

**À ne pas toucher.** Signature de `runSecretsGate` et `runDiagramsGate` (le paramètre `files` existe déjà). Le
comportement sans git et sans `baseCommit` (tâches déjà en cours) reste celui d'aujourd'hui.

**Critères d'acceptation.**
- Tâche démarrée, fichier contenant un secret créé puis commité : `ceng gate run <id>` → `secrets` en échec.
- Tâche `--domains lifecycle`, diagramme d'états ajouté puis commité : `diagrams` en `pass`.
- Tâche d'un ancien `tasks.json` (sans `baseCommit`) : même résultat qu'avant.
- Commit de base disparu (rebase) : repli sur `HEAD`, pas d'exception.

**Tests.** `test/gate-base.test.ts` : les quatre cas ci-dessus, avec `sandbox(…, true)` et des commits réels.

**Gain / coût / risque.** Qualité et sécurité (la gate `secrets` redevient réelle) ; M ; risque faible. Aucune dépendance.

---

### P-02 — Rapport remis par `SubagentHandback` reconnu

**Problème.** `src/hooks/handlers.ts:466-467` :
```ts
const message = String(input.last_assistant_message ?? '');
const hasReport = message.includes(REPORT_MARKER);
```
Depuis Claude Code 2.1.271, un sous-agent peut remettre son rapport par l'outil `SubagentHandback` ; dans ce cas
`last_assistant_message` ne contient que son texte de clôture, pas le rapport. Le hook conclut alors « rapport
manquant » et bloque l'arrêt (`handlers.ts:479-490`) : l'agent refait un tour pour réécrire son rapport.
Source : https://code.claude.com/docs/en/hooks (section SubagentStop). **À vérifier** : que l'outil est bien proposé
aux sous-agents dans la version installée (`claude --version` ≥ 2.1.271) ; le correctif est sans effet sinon.

**Changement.**
- `src/brain/store.ts`, `BrainState` : `handbackReports?: Record<string, true>;`.
- `src/hooks/handlers.ts` : nouveau gestionnaire, ajouté à `HANDLERS` sous la clé `'agent-handback'` :
  ```ts
  /** PostToolUse SubagentHandback : le rapport passe par l'outil, pas par le dernier message. */
  export function agentHandback(store: BrainStore, input: HookInput): HookOutput {
    const id = input.agent_id;
    if (!id || !String(input.tool_input?.['message'] ?? '').includes(REPORT_MARKER)) return OK;
    store.updateState((s) => {
      s.handbackReports = { ...(s.handbackReports ?? {}), [id]: true };
    });
    return OK;
  }
  ```
  Dans `subagentStop` : `const hasReport = message.includes(REPORT_MARKER) || Boolean(input.agent_id && store.state().handbackReports?.[input.agent_id]);`
  et, dans le `updateState` qui retire l'agent de `runningAgents`, supprimer aussi son entrée de `handbackReports`.
  Dans `sessionStart`, quand `source === 'startup'` : `s.handbackReports = {};`.
- `src/generation/settings.ts`, `frameworkHooks().PostToolUse` : ajouter
  `{ matcher: 'SubagentHandback', hooks: [hook('agent-handback', { timeout: 10 })] }`.

**À ne pas toucher.** Le message de blocage existant et la règle `stop_hook_active`.

**Critères d'acceptation.** Un arrêt de `ceng-builder` dont le dernier message n'a pas `CENG_REPORT`, précédé d'un
`agent-handback` qui le contient, n'est pas bloqué et ne journalise pas `agent.report-missing`. Sans l'appel
préalable, le blocage actuel est inchangé.

**Tests.** `test/handback.test.ts` avec `runtimeHook` : (1) handback puis stop → pas de `decision: block` ;
(2) stop seul → bloqué ; (3) l'entrée est effacée après l'arrêt ; (4) `settings.json` généré contient le matcher.

**Gain / coût / risque.** Un tour de sous-agent évité par délégation ; S ; faible. Aucune dépendance.

---

### P-03 — Agents et skills créatifs toujours installés

**Problème.** `src/generation/catalog.ts:53-55` et `67-69` : `creative-director`, `frontend-executor`,
`quality-gate-auditor` et leurs trois agents ne sont installés que si `p.ui` est détecté. Sur un projet vide (le cas
« cahier des charges »), ils sont absents, alors que `src/domain/routing.ts:165` route toute tâche `design` vers
`ceng-creative-director` et que `core/skills/ceng-orchestrate/bootstrap.md:27-28` demande de créer cette tâche. La
délégation part vers un type d'agent qui n'existe pas. Le commentaire `catalog.ts:27` reconnaît déjà le problème pour
`ux-principles` et `visual-flow-testing`, sans l'étendre aux agents.

**Changement.** `src/generation/catalog.ts` : passer à `when: always` les trois skills (lignes 53-55) ainsi que
`frontend` et `accessibility` (lignes 48-49). Les trois agents (lignes 67-69) suivent, puisqu'ils reprennent la
règle de leur skill. Étendre le commentaire de la ligne 27 à ces entrées.

**À ne pas toucher.** Les autres règles conditionnelles (`database`, `backend`, `observability`, `ci-cd`).

**Critères d'acceptation.** `ceng init` sur un dossier vide installe `.claude/agents/ceng-creative-director.md`,
`ceng-frontend-executor.md`, `ceng-quality-auditor.md` et les cinq skills.

**Tests.** Compléter `test/assets.test.ts` (ou `install.test.ts`) : profil sans UI → les trois agents et les cinq
skills sont sélectionnés. Adapter les assertions existantes qui comptent les skills d'un profil sans UI.

**Gain / coût / risque.** Supprime un blocage certain à la première tâche de design ; S ; faible (cinq descriptions de
plus dans la liste des skills). À faire avant P-05.

---

### P-04 — Contradictions entre agents et skills (texte seulement)

Chaque point est indépendant. Aucun code.

1. **`core/agents/ceng-principal.md:49-58`** — la sortie demande `instructions: <étapes concrètes pour le worker>` et
   n'autorise que `status: done`, alors que les lignes 12-15 interdisent de « donner une direction ». Remplacer le
   bloc par celui de `ceng-engineer.md:52-66`, en ajoutant `decision:` et `adr:`, et en gardant `subtasks:` avec la
   mention « seulement si le travail dépasse une session ». Statuts : `done | partial | blocked`.
2. **`core/agents/ceng-engineer.md:10-11`** — « Mêmes règles que ceng-builder » : l'agent ne voit pas ce fichier.
   Remplacer par les quatre règles en clair (périmètre, autonomie locale, tests réellement exécutés, action à
   approbation humaine) et recopier l'exception de bypass de `ceng-builder.md:33-34`. Même exception à ajouter dans
   `ceng-principal.md`, `ceng-tester.md` et `ceng-frontend-executor.md`, qui ne la portent pas.
3. **`core/agents/ceng-builder.md:34`** — « (le hook l'indique) » : aucun hook ne l'indique à un sous-agent
   aujourd'hui (`subagentStart` renvoie `OK`, `handlers.ts:381-400`). Devient vrai avec P-09 ; si P-09 n'est pas
   fait, écrire « (le bloc ceng de CLAUDE.md l'indique) ».
4. **`core/skills/quality-gate-auditor/SKILL.md:8-9, 22, 33, 43`** et **`core/agents/ceng-quality-auditor.md:15-16`** —
   « La direction créative est définie dans `/docs` », « mets à jour les documents de référence ». Or
   `core/skills/creative-director/SKILL.md:9-10` les interdit. Remplacer partout par : « le module de design system
   du code et l'ADR “Direction créative” (`.ceng/brain/decisions/`) » ; la seule modification permise à l'auditeur
   devient « proposer la mise à jour de l'ADR dans son rapport ». Retirer aussi « Le site a été implémenté par un
   autre modèle » (ligne 9).
5. **`core/agents/ceng-frontend-executor.md:41-42`** — `conformity: écarts volontaires vs docs` et
   `contradictions dans les docs de référence` → « vs design system » et « dans le design system ». Ajouter au bloc
   les champs `reuse:`, `removed:` (exigés par `ceng brief`, `src/cli/commands/context.ts:105`) et
   `shots: <dossier des captures>` (voir P-05).
6. **`core/agents/ceng-tester.md:15-19`** — le paragraphe « Réutiliser avant de créer une fonction, un composant, un
   endpoint, une table ou un écran » et « Nettoyer ce que tu remplaces » contredit la ligne 31 (« ne modifie pas le
   code de production »). Le réduire à : réutiliser les fixtures, fabriques et helpers de test existants ; supprimer
   les tests devenus inutiles.
7. **`core/skills/ceng-delivery/SKILL.md:99-102`** — reste de l'ancien paragraphe « Diagrammes : seulement quand ils
   portent le flux… » collé après le nouveau tableau : il redit la même chose en moins strict. Supprimer de
   « **Diagrammes : seulement** » jusqu'à « **mis à jour dans la même tâche** que le code qu'ils décrivent. » ;
   garder les deux dernières phrases (ER généré, pas de diagramme de classes).
8. **Largeurs** — `core/skills/visual-flow-testing/SKILL.md:20` impose 4 largeurs (390, 820, 1180, 1440),
   `core/skills/ux-principles/SKILL.md:90` et `src/domain/gates.ts:93` en demandent 3. Aligner sur
   `ux-principles` : « 3 largeurs obligatoires : mobile 390, tablette 820, desktop 1440 ; tablette paysage 1180 si
   l'écran a une mise en page propre à ce format ».
9. **`core/skills/visual-flow-testing/SKILL.md:74-75`** — « L'humain valide en dernier » contredit
   `ceng-delivery/SKILL.md:8-9` (il ne contrôle pas chaque étape). Écrire : « L'humain voit les captures à la fin de
   l'incrément, dans le rapport de livraison ; sa validation n'est pas attendue pour clore la tâche. »
10. **`core/skills/ceng-delivery/SKILL.md`** — la skill ne dit jamais de relancer la découverte une fois la pile
    posée ; seul `bootstrap.md:32-34` le dit, en dernier point. Ajouter au § 2, après « Incrément 1 » : « Dès que le
    manifeste du projet existe (package.json, pubspec.yaml, pyproject.toml…) : `ceng upgrade` — les commandes des
    gates et les skills de la pile sont installées ; sans cela les gates build, tests et lint restent “skipped”. »

**Critères d'acceptation.** `grep -rn "documents de référence" core/` ne renvoie plus que la phrase d'interdiction de
`creative-director` ; `grep -n "instructions:" core/agents/ceng-principal.md` ne renvoie rien ; `npm test` vert.

**Tests.** Aucun nouveau. Vérifier que `test/assets.test.ts` et `test/install.test.ts` restent verts.

**Gain / coût / risque.** Règles applicables, moins d'allers-retours ; S ; nul. Indépendant, parallélisable avec tout.

---

### P-05 — Gate `visual` prouvée par des captures

**Problème.** `src/cli/commands/work.ts:208-219` : `ceng gate record <id> visual pass --note "…"` suffit, sans
aucune vérification. `src/app/gates.ts:167-172` renvoie `pending` et ne regarde rien. La gate présentée comme
« test principal d'une interface » (`src/domain/gates.ts:93`) peut donc passer sans qu'une seule image existe.
Par ailleurs `visual-flow-testing/SKILL.md:37` range les captures « jamais dans le dépôt », dans un dossier libre :
la session suivante et l'humain ne savent pas où les trouver, alors que `ceng-delivery/SKILL.md:72` promet des
« captures du flux dans le rapport ».

**Changement.**
- Emplacement unique : `.ceng/shots/<ID-tâche>/` (non versionné). `src/generation/install.ts:166`, `GITIGNORE_BLOCK` :
  ajouter `'.ceng/shots/'`. `src/brain/paths.ts` : ajouter `shots(taskId)`.
- `src/app/gates.ts` : nouvelle fonction
  ```ts
  /** Captures du parcours d'une tâche : images présentes et postérieures au début de la tâche. */
  export function visualEvidence(dir: string, since?: string): { images: string[]; fresh: number } {
    if (!exists(dir)) return { images: [], fresh: 0 };
    const images = listFiles(dir, { maxFiles: 2000 }).files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
    const t0 = since ? Date.parse(since) : 0;
    const fresh = images.filter((f) => fs.statSync(path.join(dir, f)).mtimeMs >= t0).length;
    return { images, fresh };
  }
  ```
- `src/cli/commands/work.ts`, branche `record` : option `shots: { type: 'string' }`. Si `gate === 'visual'` et
  `status === 'pass'` : dossier = `--shots` ou `.ceng/shots/<id>/` ; `since` = `startedAt` de la première tentative ;
  exiger `fresh >= 3` (une capture par largeur au minimum), sinon `UsageError` : « Aucune capture récente dans
  <dossier> : capturer le parcours (skill visual-flow-testing) ou enregistrer `waived` avec la raison. » Le détail
  enregistré devient `"<n> captures dans <dossier> — <note>"`. `fail` et `waived` restent libres.
- `core/skills/visual-flow-testing/SKILL.md` : § 2 « Rangement » → `.ceng/shots/<tâche>/<parcours>/<NN-étape>_<largeur>.png` ;
  § 6 → le rapport cite ce dossier ; ajouter au § 4 la règle d'indépendance : « celui qui relit n'est pas celui qui a
  codé : l'exécutant capture et corrige ses propres écarts, puis la relecture qui enregistre la gate est faite par
  `ceng-quality-auditor` (tâche `design`, ou risque ≥ 3) ou par l'orchestrateur sur une capture par largeur (autres cas). »
- `core/skills/quality-gate-auditor/SKILL.md:45` et `core/skills/frontend-executor/SKILL.md:32-33` : citer le dossier
  et l'option `--shots`.
- `src/cli/commands/context.ts:102` : compléter la ligne « Validation visuelle » par
  `Captures à écrire dans .ceng/shots/${task.id}/.`

**À ne pas toucher.** Les gates `ux` et `accessibility` (toujours déclaratives). Le format de `GateResult`.

**Critères d'acceptation.**
- `gate record T-0001 visual pass --note x` sans capture → erreur, code de sortie non nul, gate inchangée.
- Avec 3 PNG récents dans `.ceng/shots/T-0001/` → `pass`, détail contenant « 3 captures ».
- Captures antérieures au début de la tâche → refus.
- `gate record … visual waived --note "raison"` → accepté.

**Tests.** `test/visual-gate.test.ts` : les quatre cas, plus `visualEvidence` sur dossier absent.

**Gain / coût / risque.** Le test principal devient vérifiable ; M ; risque moyen : une équipe qui capture ailleurs
doit passer `--shots`. Dépend de P-03 (auditeur installé). Voir D-2 pour le modèle de l'auditeur.

---

### P-06 — Brief de reprise complet et consignes de compaction

**Problème.**
- `src/brain/brief.ts:83-93` ne décrit que `state.currentTask`. Avec un lot parallèle, les autres tâches
  `in_progress` et les sous-agents encore actifs n'apparaissent pas : après compaction ou reprise, l'orchestrateur
  relance ou oublie du travail en cours.
- Aucune décision en vigueur n'y figure (seulement celles « prises sans l'humain », lignes 104-108), ni l'existence
  de `.ceng/brain/spec.md` et des chantiers (`delegation.md:62-67`).
- `src/hooks/handlers.ts:493-502` (`preCompact`) ne renvoie rien, alors que la sortie standard d'un hook PreCompact
  sert d'instructions au résumé de compaction (source : https://code.claude.com/docs/en/hooks, section PreCompact).
- `renderIndex` (`brief.ts:69-73`) ne cite ni `spec.md` ni `chantiers/`.

**Changement.**
- `src/brain/brief.ts`, `resumeBrief` — après le bloc `if (current) {…}` :
  ```ts
  const others = tasks.filter((t) => t.status === 'in_progress' && t.id !== current?.id);
  if (others.length) parts.push(`Aussi en cours : ${others.map((t) => `${t.id} ${t.title}`).join(' ; ')}.`);
  const agents = Object.values(state.runningAgents ?? {}).filter(Boolean);
  if (agents.length) parts.push(`Sous-agents encore actifs sur : ${[...new Set(agents)].join(', ')} — attendre leur rapport, ne pas relancer ces tâches.`);
  ```
  Puis : les 5 décisions les plus récentes non remplacées (titre seul, une ligne), en réutilisant la fonction de
  lecture des décisions extraite en P-07 ; et une ligne de pointeurs si les fichiers existent :
  « Cahier des charges : .ceng/brain/spec.md » et « Chantier(s) : .ceng/brain/chantiers/<nom>/VISION.md ».
  `MAX_BRIEF_CHARS` (6000) inchangé.
- `renderIndex` : ajouter `spec.md` et `chantiers/` à la section « Où trouver le reste », seulement s'ils existent.
- `src/hooks/handlers.ts` : ajouter `stdout?: string` au type `HookOutput` ; `src/hooks/run.ts:44` : écrire
  `out.stdout` quand `out.json` est absent. `preCompact` renvoie :
  ```ts
  return { exitCode: 0, stdout: [
    'Dans le résumé, conserver : identifiant et titre des tâches ceng en cours, sous-agents lancés et tâche de chacun,',
    'décisions prises pendant la session et leur raison, questions posées à l\'humain et réponses, prochaine action exacte.',
    'Ne pas conserver : contenu des fichiers lus, sorties d\'outils, détail des explorations.',
  ].join(' ') };
  ```

**À ne pas toucher.** Le checkpoint automatique pris dans `preCompact`. La taille maximale du brief.

**Critères d'acceptation.** Avec deux tâches `in_progress` et un agent enregistré dans `runningAgents`, le brief
contient « Aussi en cours » et « Sous-agents encore actifs ». Le hook `pre-compact` écrit un texte non JSON sur la
sortie standard et sort en 0. Le brief reste sous 6000 caractères avec 30 décisions.

**Tests.** `test/resume-brief.test.ts` (brief) ; `test/compact.test.ts` (sortie du hook via `runtimeHook`).

**Gain / coût / risque.** Moins de travail relancé ou oublié sur les longues sessions ; M ; faible. Dépend de P-07
pour la lecture des décisions.

---

### P-07 — `ceng brief` : décisions pertinentes, pas les 12 dernières

**Problème.** `src/cli/commands/context.ts:49-52` :
```ts
.filter((f) => f.endsWith('.md'))
.sort()
.slice(-12)
```
Au-delà de 12 ADR, les plus anciennes — pile, modèle de données, direction créative, donc les plus structurantes —
sortent de tous les paquets de délégation. Les workers ne les voient plus.

**Changement.**
- Créer `src/app/decisions.ts` : `listDecisions(store): { file: string; title: string; status: string; text: string }[]`
  (lecture du dossier, titre, statut, exclusion des remplacées et rejetées — code repris de `context.ts:46-61`, qui
  est supprimé) et `relevantDecisions(store, task, limit = 8)`.
- Classement de `relevantDecisions` : score = `scoreWords` (`src/domain/similarity.ts`) entre le titre + les domaines
  + les fichiers de la tâche et le titre + le texte de la décision. Garder les `limit` meilleures de score > 0, puis
  compléter avec les décisions structurantes (texte contenant « architecture », « pile », « stack », « schéma »,
  « Direction créative ») jusqu'à `limit`. Sortie triée par nom de fichier. **À vérifier** : la signature exacte de
  `scoreWords` avant de l'appeler (elle est décrite dans `similarity.ts`, non relue ligne à ligne pendant l'audit).
- `context.ts` : `const decisions = relevantDecisions(store, task).map(…)` ; même format de ligne qu'aujourd'hui.

**À ne pas toucher.** Le format des fichiers ADR et la commande `ceng decision`.

**Critères d'acceptation.** Avec 20 décisions dont la n° 1 « Paiement : Stripe Connect » et une tâche
`--domains payments`, le brief cite la n° 1. Aucune décision « remplacée » n'apparaît. Au plus 8 lignes.

**Tests.** `test/decisions.test.ts` : pertinence, exclusion des remplacées, plafond, dossier vide.

**Gain / coût / risque.** Fin des décisions oubliées par les workers ; S ; faible. À faire avant P-06.

---

### P-08 — Reprendre le même sous-agent pour corriger (`SendMessage`)

**Problème.** `src/domain/routing.ts:309-323` produit des phases distinctes pour le même agent (`test-design`,
`implement`, `test`, `refine`). Ni `core/skills/ceng-orchestrate/SKILL.md:32-43` ni `delegation.md` ne disent
qu'elles forment une seule délégation, ni comment renvoyer les constats d'une revue : l'orchestrateur relance un
agent à froid, qui relit tous les fichiers. Claude Code permet de reprendre un sous-agent terminé, avec tout son
historique, par l'outil `SendMessage` et son identifiant d'agent, sans Agent Teams.
Source : https://code.claude.com/docs/en/sub-agents (section « Resume subagents »).

**Changement** (texte).
- `core/skills/ceng-orchestrate/delegation.md`, nouvelle section après « Budget de contexte » :
  ```
  ## Une tâche, un agent, une conversation
  - Les phases de la route qui portent le même agent (test-design, implement, test, refine) sont UNE délégation :
    un seul appel à l'outil Agent, dont le brief demande toute la séquence.
  - Corrections après revue, gate rouge ou rapport `partial` : reprends le MÊME agent avec `SendMessage` (son
    identifiant est renvoyé à la fin de sa mission) en lui donnant seulement les constats à corriger. Il a déjà
    les fichiers en contexte : ne relance pas un agent neuf, ne recolle pas le brief.
  - Nouvel agent seulement si : stratégie différente après un échec (`task fail`), escalade vers Opus, ou agent
    dont la conversation a été compactée.
  - Relecteurs (`ceng-reviewer`, `ceng-security`, `ceng-quality-auditor`) : toujours un agent neuf, jamais celui
    qui a écrit le code.
  ```
- `core/skills/ceng-orchestrate/SKILL.md` § 1, ligne « exécuter les phases » : ajouter
  « (phases du même agent = une seule délégation ; corrections = `SendMessage` au même agent) ».
- `core/skills/ceng-orchestrate/iteration.md`, § Refine : même renvoi en une phrase.

**À ne pas toucher.** `routing.ts` (les phases restent utiles pour l'explication et le coût).

**Critères d'acceptation.** Les trois fichiers contiennent la règle ; `npm test` vert.

**Tests.** Aucun.

**Gain / coût / risque.** Jetons et vitesse : la boucle revue → correction ne relit plus le code ; S ; nul.
Note pour P-16 : `SubagentStart` se déclenche aussi à la reprise d'un agent (même source).

---

### P-09 — Contexte d'état injecté au démarrage du sous-agent

**Problème.** `src/hooks/handlers.ts:381-400` : `subagentStart` renvoie `OK`. Un sous-agent n'apprend l'état du
projet (bypass, stade prototype) que par le bloc de CLAUDE.md, et `ceng-scout` (`omitClaudeMd: true`) ne l'apprend
jamais. Il ne reçoit pas non plus l'identifiant de tâche que le framework lui a rattaché. Un hook SubagentStart peut
renvoyer `additionalContext`, ajouté au contexte du sous-agent avant son premier prompt.
Source : https://code.claude.com/docs/en/hooks (section SubagentStart).

**Changement.** `src/hooks/handlers.ts`, fin de `subagentStart`, à la place de `return OK;` :
```ts
if (!String(input.agent_type ?? '').startsWith('ceng-')) return OK;
const mode = bypassOn(store)
  ? 'BYPASS TOTAL actif : aucune validation à attendre ; secrets utilisés sans être affichés ni recopiés.'
  : stageOf(store) === 'prototype' ? 'Stade prototype : migrations, suppressions et push du projet sans validation.' : 'Stade production : toute action à approbation humaine est remontée, jamais tentée.';
const note = `[ceng] ${taskId ? `Tâche rattachée : ${taskId}. ` : ''}${mode} Termine par le bloc ${REPORT_MARKER}.`;
return { exitCode: 0, json: { hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: note } } };
```

**À ne pas toucher.** Le rattachement `pendingSpawns` → `agentTasks`. Les agents hors `ceng-*` ne reçoivent rien.

**Critères d'acceptation.** `runtimeHook(dir, 'subagent-start', { agent_id: 'a1', agent_type: 'ceng-builder' })`
renvoie un `additionalContext` de moins de 400 caractères ; il contient « BYPASS TOTAL » quand le bypass est actif ;
rien pour `agent_type: 'Explore'`.

**Tests.** `test/subagent-context.test.ts` : production, prototype, bypass, agent étranger.

**Gain / coût / risque.** Règles de bypass et de stade réellement connues des workers (environ 60 jetons par
délégation) ; S ; faible. Fait avant ou avec P-04 (point 3).

---

### P-10 — `route` cohérent avec le bypass et la direction créative

**Problème.**
- `src/cli/commands/work.ts:32` affiche « ⚠ APPROBATION HUMAINE » même quand le bypass est actif, alors que
  `ceng-orchestrate/SKILL.md:136-137` dit de n'attendre aucune approbation.
- `src/domain/routing.ts:166-169` : une tâche `ui` sans direction créative part vers `ceng-builder`, sans la skill
  `ux-principles` préchargée et sans avertissement.

**Changement.**
- `work.ts`, fonction qui rend la route : si `store.config().bypass?.enabled`, remplacer la ligne par
  `Approbation humaine levée (bypass total) : ${r.humanApproval.reason}`.
- `routing.ts`, `chooseImplementer`, après le test `task.kind === 'ui' && ctx.hasCreativeDirection` :
  ```ts
  if (task.kind === 'ui') f.reasons.push('Aucune direction créative : créer d\'abord une tâche --kind design (design system dans le code), sinon l\'écran sera générique.');
  ```

**À ne pas toucher.** Le calcul de `humanApproval` (pur, sans accès à la configuration).

**Critères d'acceptation.** `ceng route <id>` en bypass n'affiche plus « ⚠ APPROBATION HUMAINE ». Une tâche `ui` sans
tâche `design` terminée porte l'avertissement dans `reasons`.

**Tests.** Compléter `test/routing.test.ts` (raison présente ou absente) et `test/bypass.test.ts` (sortie de `route`).

**Gain / coût / risque.** Clarté ; S ; nul.

---

### P-11 — Re-découverte automatique quand la pile change

**Problème.** `src/app/gates.ts:144-145` : une gate de commande sans commande est `skipped`, et
`src/app/tasks.ts:156` accepte `skipped` pour une gate requise. Sur un projet vide à l'init, aucune commande n'est
détectée : build, typecheck, lint et tests sont « satisfaits » sans jamais tourner, jusqu'à ce que quelqu'un lance
`ceng upgrade` (`bootstrap.md:32-34`). La mise à jour automatique (`handlers.ts:198-217`) ne se déclenche que si le
framework change, pas quand le projet gagne un manifeste.

**Changement.**
- `src/app/registry.ts` : `stackFingerprint(root): string` — sha256 de la liste « nom:taille:mtime » des manifestes
  présents à la racine et un niveau en dessous : `package.json`, `pubspec.yaml`, `pyproject.toml`,
  `requirements.txt`, `go.mod`, `Cargo.toml`, `composer.json`, `Gemfile`, `pom.xml`, `build.gradle(.kts)`,
  `supabase/config.toml`, `Dockerfile`. Réutiliser le hachage de `frameworkFingerprint`.
- `src/generation/install.ts`, `Manifest` : `stackBuild?: string`, écrit à chaque init/upgrade.
- `src/hooks/handlers.ts`, `autoUpgrade` : la sortie anticipée `build === installed` devient
  « framework inchangé ET `stackFingerprint(root) === manifest.stackBuild` ». Message distinct quand seule la pile a
  changé : « Pile du projet modifiée : commandes des gates et skills re-détectées en arrière-plan. »
- `src/app/gates.ts:145` : compléter le détail du `skipped` par « — `ceng upgrade` si la pile vient d'être posée ».

**À ne pas toucher.** La règle `commands: { ...profile.commands, ...previousConfig.commands }`
(`install.ts:220`) : une commande choisie par l'humain n'est jamais écrasée. Le délai de 10 minutes entre deux mises
à jour. Les variables `CENG_NO_AUTO_UPGRADE` et `CENG_AUTO_UPGRADE_CHILD`.

**Critères d'acceptation.** Projet initialisé vide ; ajout d'un `package.json` avec script `test` ; au démarrage de
session suivant, une mise à jour d'arrière-plan part, et `.ceng/config.json` contient la commande `unit`. Sans
changement de manifeste, aucune mise à jour.

**Tests.** `test/registry.test.ts` : empreinte stable sans changement, différente après ajout d'un manifeste ;
déclenchement (même attente que le test existant sur `frameworkBuild`).

**Gain / coût / risque.** Les gates deviennent réelles dès que le code existe ; M ; risque moyen (une mise à jour de
plus en arrière-plan : garder le test de non-concurrence existant). Lié à D-1.

---

### P-12 — Contrôle des migrations SQL

**Problème.** `src/domain/code-check.ts:27` : `SKIP_PATH` exclut tout chemin contenant `migrations/`. Or
`ceng-delivery/SKILL.md` (§ 3, tableau) fait de la migration SQL le livrable du modèle de données, écrit à la main.
C'est le fichier où une erreur coûte le plus (table sans RLS exposée par l'API Supabase, clé étrangère sans index,
`drop` sans garde) et c'est le seul que le contrôle immédiat ne lit pas.

**Changement.** `src/domain/code-check.ts` :
- ne plus ignorer les `.sql` des dossiers `migrations/` (garder l'exclusion pour les autres extensions, souvent
  générées) ;
- nouvelles règles, appliquées au texte écrit d'un fichier `.sql` :
  - `rls-missing` (avertissement ; seulement si le chemin contient `supabase/`) : `create table <t>` sans
    `alter table <t> enable row level security` dans le même texte ;
  - `fk-no-index` (avertissement) : colonne déclarée `references <table>` sans `create index … (<colonne>` ni clé
    primaire ou contrainte `unique` sur cette colonne dans le même texte ;
  - `destructive-migration` (avertissement) : `drop table`, `drop column` ou `truncate` sans commentaire
    `-- expand/contract` ou `-- irréversible :` sur la ligne précédente ;
  - `select-star` existant : inchangé.
- Messages courts, au format des règles existantes (`formatFindings`).

**À ne pas toucher.** Les règles bloquantes existantes ; les limites configurables `codeCheck` de la configuration.

**Critères d'acceptation.** Un `supabase/migrations/001_init.sql` créant une table sans RLS produit `rls-missing` ;
avec la ligne `enable row level security`, plus rien. Une migration générée d'un ORM en `.ts` reste ignorée.

**Tests.** Compléter `test/code-check.test.ts` : un cas positif et un cas négatif par règle, et le cas hors `supabase/`.

**Gain / coût / risque.** Sécurité et coûts en production ; M ; risque moyen (faux positifs : avertissements
seulement, jamais bloquants).

---

### P-13 — Traçabilité exigence → tâche

**Problème.** `ceng-delivery/SKILL.md:58` exige que « chaque exigence [soit] tracée jusqu'à une tâche et un test
(EX-014 → T-0031) ». `Task` (`src/domain/types.ts:53-76`) n'a aucun champ pour cela et `task add` aucune option :
la règle ne peut être tenue qu'à la main, dans un document. Rien ne peut lister les exigences non couvertes à la
livraison.

**Changement.**
- `types.ts`, `Task` : `spec?: string[];` (identifiants `EX-xxx`).
- `src/app/tasks.ts`, `NewTaskInput` et `createTask` : champ `spec`. `src/cli/commands/work.ts`, `task add` :
  option `--spec EX-001,EX-002` (via `csv`).
- `src/cli/commands/context.ts`, `briefCommand` : section « Exigences du cahier des charges couvertes » qui cite,
  pour chaque identifiant, la ligne correspondante de `.ceng/brain/spec.md` (recherche de `EX-xxx` en début de
  ligne ou de puce ; 200 caractères au plus).
- Nouvelle commande `ceng spec coverage` (`src/cli/commands/spec.ts`, enregistrée dans `src/cli.ts`) : lit les
  identifiants `EX-\d{3,}` de `spec.md`, les croise avec les tâches, affiche trois listes : couvertes et terminées,
  couvertes non terminées, sans tâche. Code de sortie 1 s'il reste des exigences sans tâche.
- `ceng-delivery/SKILL.md` : § 1 (« tracée ») → `task add --spec …` ; § 8 → `ceng spec coverage` doit être vide de
  « sans tâche » avant le rapport final.

**À ne pas toucher.** Le format de `spec.md` décrit par la skill.

**Critères d'acceptation.** Avec un `spec.md` contenant EX-001 à EX-003 et une tâche `--spec EX-001`, la commande
liste EX-002 et EX-003 « sans tâche » et sort en 1.

**Tests.** `test/spec-coverage.test.ts`.

**Gain / coût / risque.** Livraison réellement complète, vérifiable sans relire le cahier ; M ; faible.

---

### P-14 — Skill d'orchestration sous 5 000 jetons

**Problème.** `core/skills/ceng-orchestrate/SKILL.md` pèse 15 887 octets (178 lignes longues) et
`ceng-delivery/SKILL.md` 14 063. Après compaction, Claude Code ne rattache que les 5 000 premiers jetons de chaque
skill invoquée (25 000 au total). Source : https://code.claude.com/docs/en/skills. **À vérifier** : le compte exact
en jetons (estimation : 4 500 à 5 500 pour `ceng-orchestrate`) ; s'il dépasse, la fin du fichier (§ 6 bis à § 7)
disparaît après compaction, précisément pendant les longues sessions autonomes.

**Changement.**
- Déplacer `SKILL.md:142-163` (§ 6 bis, mode sans humain) dans `core/skills/ceng-orchestrate/unattended.md`.
  Laisser à la place : « ## 6 bis. Mode sans humain — prompt commençant par “MODE SANS HUMAIN”, ou retour de
  l'humain après une nuit : lis [unattended.md](unattended.md). »
- Ajouter `unattended.md` à la liste des références de la dernière ligne.
- Vérifier que le prompt du mode nuit (`src/cli/commands/night.ts` ou `run.ts`) cite ce fichier ; sinon ajouter
  « Lis d'abord .claude/skills/ceng-orchestrate/unattended.md ».
- Objectif : `SKILL.md` ≤ 13 000 octets.

**À ne pas toucher.** Le contenu des règles (déplacement sans réécriture).

**Critères d'acceptation.** `wc -c core/skills/ceng-orchestrate/SKILL.md` ≤ 13 000 ; `unattended.md` installé par
`ceng init` (à vérifier dans `test/install.test.ts` : les fichiers d'un dossier de skill sont-ils tous copiés ?).

**Tests.** Une assertion de taille dans `test/assets.test.ts` (garde-fou durable : `SKILL.md` de `ceng-orchestrate`
et `ceng-delivery` ≤ 14 500 octets).

**Gain / coût / risque.** Protocole intact après compaction ; environ 1 200 jetons de moins par session
interactive ; S ; faible.

---

### P-15 — Un seul processus pour les hooks après écriture

**Problème.** `src/generation/settings.ts:44-45` : chaque `Edit`/`Write` lance deux processus Node après l'outil
(`file-edited` asynchrone, `code-check` synchrone), en plus de `guard-file` avant. Sur une livraison de plusieurs
centaines d'écritures, c'est du temps mort (ordre de grandeur : 100 ms par démarrage de Node sous Windows —
**à vérifier** par une mesure).

**Changement.**
- `src/hooks/handlers.ts` : `export function afterEdit(store, input)` qui appelle `fileEdited(store, input)` puis
  renvoie `codeCheck(store, input)`. Clé `'after-edit'` dans `HANDLERS` ; les clés `file-edited` et `code-check`
  restent (projets pas encore mis à jour).
- `settings.ts:44-45` → une seule entrée
  `{ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [hook('after-edit', { timeout: 10 })] }`.
  `codeCheck` sort déjà immédiatement sans `file_path` (cas `NotebookEdit`).

**À ne pas toucher.** `mergeSettings` remplace déjà les hooks du framework à chaque upgrade (`settings.ts:128-136`) :
aucune migration à écrire.

**Critères d'acceptation.** `settings.json` généré n'a plus qu'un hook PostToolUse pour l'écriture ; un `after-edit`
incrémente `editsSinceCheckpoint` et renvoie l'avertissement de `code-check` dans le même appel.

**Tests.** Compléter `test/code-check.test.ts` (appel `after-edit`) et le test de génération des réglages.

**Gain / coût / risque.** Un processus de moins par écriture ; S ; faible. Dette voisine, à traiter à part :
`src/hooks/handlers.ts` fait 819 lignes, au-delà de la limite de 500 que `code-check` impose aux projets
(`code-check.ts:24`) — le scinder par famille (gardes, sous-agents, fin de tour, questions) dans une tâche dédiée,
sans changement de comportement.

---

### P-16 — Attribution agent → tâche sûre en parallèle

**Problème.** `src/hooks/handlers.ts:386-387` :
```ts
const i = pending.findIndex((p) => p.agentType === input.agent_type);
```
Le rattachement se fait par type d'agent, dans l'ordre d'arrivée. Deux `ceng-builder` lancés dans le même message
(le cas normal d'un lot parallèle, `delegation.md:32-33`) peuvent être rattachés à la tâche l'un de l'autre si leurs
événements `SubagentStart` n'arrivent pas dans l'ordre des appels. `guardFile` (`handlers.ts:322-337`) refuse alors à
chacun ses propres fichiers (« appartient à la tâche en cours T-… »). **À vérifier** : l'ordre réel des événements
(non documenté) ; reproduire avec deux délégations parallèles du même type et lire `.ceng/logs/events.jsonl`.
De plus `SubagentStart` se déclenche aussi à la reprise d'un agent (voir P-08) : `runningAgents[agentId]` est alors
réécrit à `''` (ligne 394) alors que `agentTasks` connaît sa tâche.

**Changement.**
- `subagentStart` : si `agentTasks[agentId]` existe déjà (reprise), réutiliser cette tâche et ne pas consommer
  `pendingSpawns`.
- Liaison confirmée au premier fichier écrit — dans `guardFile`, avant le calcul de `owner` : si le fichier n'est pas
  dans le périmètre de `myTask` mais est dans celui d'une autre tâche portée par un agent du **même type** lancé
  dans la même fenêtre (`SPAWN_MATCH_WINDOW_MS`), échanger les deux rattachements dans `agentTasks` et
  `runningAgents` (un `updateState`), journaliser `agent.spawn` avec `data: { phase: 'rebound' }`, et laisser passer.
  Pour cela, mémoriser le type d'agent : `BrainState.agentTypes?: Record<string, string>` rempli dans `subagentStart`.

**À ne pas toucher.** Le verrou entre agents de types différents ou de fenêtres différentes.

**Critères d'acceptation.** Deux agents `ceng-builder` rattachés à l'envers : la première écriture de chacun dans
son vrai périmètre passe et corrige le rattachement ; une écriture dans le périmètre d'une tâche portée par un agent
d'un autre type reste refusée.

**Tests.** Compléter `test/delegation.test.ts` : inversion corrigée, verrou conservé, reprise d'agent.

**Gain / coût / risque.** Évite des refus à tort en plein lot parallèle ; M ; risque moyen (logique de verrou) —
d'où le niveau « ensuite » et la vérification préalable.

---

## 4. Décisions à poser à l'humain

### D-1 — Gate requise sans commande : bloquer ou non ?
`src/app/tasks.ts:156` accepte `skipped` pour une gate requise. **Question :** quand une tâche de code n'a aucune
commande de test détectée, faut-il empêcher `task done` ?
- **A (recommandé)** : bloquer seulement `unit` sur les tâches `feature`, `bug`, `refactor`, `security`, avec le
  message « poser la commande de test (`ceng upgrade`) ou déroger avec `--waive` ». Garantit qu'aucune
  fonctionnalité n'est close sans test exécuté.
- **B** : ne rien bloquer, mais afficher l'avertissement à chaque `task done` et dans `ceng report`.
- **C** : garder le comportement actuel (P-11 suffit).

### D-2 — Modèle de l'auditeur visuel
`core/agents/ceng-quality-auditor.md:4-5` : Opus, effort élevé, pour relire des captures. **Question :** quel modèle
pour la relecture des images ?
- **A (recommandé)** : Sonnet par défaut ; Opus seulement pour la tâche `design` initiale et les tâches à risque ≥ 4
  (paramètre `model` à la délégation). La grille de `visual-flow-testing` § 3 est explicite, et le plafond
  hebdomadaire Opus est préservé.
- **B** : Opus partout (qualité maximale, coût élevé à chaque écran).
- **C** : Sonnet partout.

### D-3 — Mémoire persistante des sous-agents
Claude Code offre `memory: project` dans le frontmatter d'un agent (dossier `.claude/agent-memory/<agent>/`, les 200
premières lignes de `MEMORY.md` chargées à chaque lancement). Source : https://code.claude.com/docs/en/sub-agents.
Aucun agent ceng ne l'utilise ; l'apprentissage passe par `ceng learn`. **Question :** l'activer ?
- **A (recommandé)** : seulement pour `ceng-reviewer` et `ceng-quality-auditor` (défauts récurrents du projet,
  conventions constatées) ; les autres restent sans mémoire pour garder des paquets minimaux.
- **B** : pour tous les agents qui écrivent.
- **C** : non, tout reste dans `ceng learn`.

Limites : sans effet si la mémoire automatique est désactivée ; elle réactive Read, Write et Edit pour l'agent, ce
qui lève la lecture seule de `ceng-reviewer`.

### D-4 — Worktrees : intégration des résultats
`src/domain/planner.ts:96` choisit `worktree` pour un lot dont une tâche n'a pas de périmètre. Le dépôt ne contient
aucune étape d'intégration : `.ceng/brain/` est versionné, donc un sous-agent en worktree écrit son rapport et lit
`tasks.json` dans **sa** copie ; la gate `report` (`gates.ts:164-166`) cherche le rapport dans la copie principale.
**À vérifier** par un essai réel (un `ceng-builder` avec `isolation: "worktree"`, puis `ceng gate run`).
**Question :** que faire du mode worktree ?
- **A (recommandé)** : le réserver aux lots où il est indispensable et ajouter `ceng integrate <id> --branch <b>`
  (fusion, copie du rapport, puis gates) — coût M.
- **B** : le retirer du planner : un lot sans périmètre passe en séquentiel.
- **C** : ne rien changer et documenter la fusion manuelle dans `delegation.md`.

### D-5 — Mesure réelle des jetons par agent
`costIndex` (`routing.ts:116-118`) est une estimation. Le hook SubagentStop reçoit `agent_transcript_path`
(source : https://code.claude.com/docs/en/hooks), d'où l'on peut lire l'usage réel. **Question :** l'exploiter ?
- **A (recommandé)** : oui, somme des jetons d'entrée et de sortie par tâche, agent et modèle dans
  `events.jsonl`, affichée par `ceng report` et utilisée par `ceng adapt` — coût M.
- **B** : seulement l'afficher, sans adapter le routage.
- **C** : non.

**À vérifier** : le format des lignes d'usage du fichier de transcription.

### D-6 — `omitClaudeMd` pour les agents de lecture
Seul `ceng-scout` l'utilise (`core/agents/ceng-scout.md:8`). **Question :** l'étendre ?
- **A (recommandé)** : `ceng-researcher` uniquement (il ne touche pas au code du projet) ; les relecteurs gardent
  CLAUDE.md, car les conventions du projet font partie de ce qu'ils vérifient. À faire après P-09, qui leur donne
  l'état du projet sans CLAUDE.md.
- **B** : aussi `ceng-reviewer` et `ceng-security`.
- **C** : ne rien changer.

Source : https://code.claude.com/docs/en/sub-agents (champ `omitClaudeMd`, version 2.1.271 ou plus).

## 5. Ordre d'exécution conseillé

**Vague 1 — en parallèle, fichiers disjoints**
- P-04 (texte : `core/agents/*`, skills) — un agent.
- P-01 (`src/app/gates.ts`, `src/app/tasks.ts`, `src/infra/git.ts`, `types.ts`).
- P-03 (`src/generation/catalog.ts`).
- P-07 (`src/cli/commands/context.ts`, nouveau `src/app/decisions.ts`).

**Vague 2 — tout ce qui touche `src/hooks/handlers.ts`, par un seul agent, dans cet ordre**
P-02 → P-09 → P-06 (qui a besoin de P-07). `settings.ts`, `run.ts` et `brief.ts` sont modifiés dans la même passe.
En parallèle de cette vague : P-08 (texte : `delegation.md`, `SKILL.md`, `iteration.md`) — après P-04, pour éviter
deux agents sur les mêmes fichiers de skills.

**Vague 3**
- P-05 (`work.ts`, `gates.ts`, `install.ts`, skills visuelles) — après P-01 (même fichier `gates.ts`), P-03 et P-04.
- P-10 (`work.ts`, `routing.ts`) — après P-05 (même fichier `work.ts`).

**Ensuite, sans urgence** : P-14 et P-12 en parallèle ; P-13 (touche `work.ts`, `context.ts`, `types.ts` : après
P-05, P-07 et P-10) ; P-11, puis P-15, puis P-16 (tous dans `handlers.ts`, donc l'un après l'autre).

**Contrôle final** : `npm run build && npm test`, puis `ceng upgrade` sur un projet d'essai vide pour vérifier P-03
et P-11, et mise à jour des compteurs de tests dans `README.md` et `docs/validation.md`.

Les décisions D-1 à D-6 se posent en une seule invite après la vague 3 ; D-4 et D-5 demandent d'abord l'essai
indiqué dans leur fiche.
