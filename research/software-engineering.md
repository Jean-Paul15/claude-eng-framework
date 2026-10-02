# Pratiques d'ingénierie : qualité, revue, Git, CI/CD, release, observabilité, performance, a11y

Sources :
- Google Engineering Practices, *Code Review* — https://google.github.io/eng-practices/review/
- Martin Fowler, *Refactoring* (2e éd.) ; Kent Beck, *Tidy First?* (2023)
- Ousterhout, *A Philosophy of Software Design* (modules profonds, complexité)
- Hunt & Thomas, *The Pragmatic Programmer* (DRY = connaissance, pas texte)
- YAGNI / KISS : Fowler — https://martinfowler.com/bliki/Yagni.html
- DORA, *Accelerate State of DevOps* — https://dora.dev (fréquence de déploiement, lead time, taux d'échec, MTTR)
- Trunk-based development — https://trunkbaseddevelopment.com ; Conventional Commits — https://www.conventionalcommits.org
- Semantic Versioning — https://semver.org
- Google SRE Book, ch. *Release Engineering*, *Canarying Releases* (SRE Workbook)
- OpenTelemetry — https://opentelemetry.io ; Charity Majors et al., *Observability Engineering*
- web.dev Core Web Vitals — https://web.dev/articles/vitals
- WCAG 2.2 ; WAI-ARIA Authoring Practices — https://www.w3.org/WAI/ARIA/apg/
- Nielsen, *Response Times: The 3 Important Limits* — https://www.nngroup.com/articles/response-times-3-important-limits/

## Principes et leur domaine de validité

| Principe | Utile quand | Nocif quand |
|---|---|---|
| DRY | Même **connaissance** (règle métier) dupliquée | Factoriser deux codes qui se ressemblent mais évoluent différemment |
| SOLID | Code à durée de vie longue avec variations réelles | Interfaces à implémentation unique « au cas où » |
| KISS | Toujours le défaut | Jamais nocif ; mais « simple » ≠ « simpliste » (gérer les erreurs) |
| YAGNI | Fonctionnalités spéculatives | Ignorer un besoin non-fonctionnel connu (sécurité, migration) |
| Modules profonds | Interface petite, implémentation riche | — |
| Faible couplage / forte cohésion | Toujours un critère d'évaluation | — |

## Revue de code

- Objectif : améliorer la santé du code, pas la perfection (Google). Ordre : conception →
  fonctionnalité → complexité → tests → nommage → commentaires → style.
- **Budget de revue proportionnel au risque** : petite modif → tests suffisent ; moyenne → revue
  ciblée sur le diff ; critique → revue sécurité + architecture + intégration.
- Une revue trouve des **défauts**, pas des préférences ; chaque remarque classée
  (bloquant / recommandé / mineur).

## Git & release

- Commits atomiques, messages expliquant le *pourquoi* ; convention détectée du dépôt (ex.
  Conventional Commits) plutôt qu'imposée.
- Branche de travail par fonctionnalité si le dépôt utilise des PR ; jamais de réécriture d'historique
  partagé ; push forcé = approbation humaine.
- Release : SemVer si bibliothèque ; déploiements progressifs (canary, feature flags) et rollback
  documenté pour les services ; migrations expand/contract.

## Observabilité

- Logs structurés (JSON), corrélation (trace/span IDs), métriques RED/USE, pas de données sensibles
  dans les logs. Le framework s'applique la même règle : journal d'événements JSONL redacted.

## Performance

- Mesurer avant d'optimiser ; éviter d'emblée les anti-patterns connus (N+1, I/O en boucle,
  complexité quadratique sur données réalistes, re-rendus inutiles) ; budgets (Core Web Vitals : LCP
  ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1).

## Accessibilité & UX

- WCAG 2.2 AA par défaut pour toute UI : contraste, clavier, focus visible, rôles ARIA corrects,
  `prefers-reduced-motion` ; seuils de Nielsen (0,1 s / 1 s / 10 s) pour le feedback.

## Conclusion pour le framework

- Les principes sont exposés dans la skill `software-engineering` comme **critères d'évaluation
  avec leurs contre-indications**, pas comme des injonctions.
- Les gates sont **sélectionnées selon le risque** (build, types, lint, tests, sécurité, migration,
  contrat, perf, a11y, UX, docs) et exécutées avec les commandes du projet.
