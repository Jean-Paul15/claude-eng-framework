# Architecture logicielle, données, API, systèmes distribués

Sources :
- Robert C. Martin, *Clean Architecture* (2017) ; *Clean Code* (2008)
- Alistair Cockburn, *Hexagonal Architecture* — https://alistair.cockburn.us/hexagonal-architecture/
- Martin Fowler, *Patterns of Enterprise Application Architecture* ; articles sur le monolithe
  modulaire et `MonolithFirst` — https://martinfowler.com/bliki/MonolithFirst.html
- Michael Nygard, *Documenting Architecture Decisions* (ADR) — https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
- Martin Kleppmann, *Designing Data-Intensive Applications* (transactions, isolation, réplication, cohérence)
- Jepsen — https://jepsen.io/consistency (modèles de cohérence)
- PostgreSQL docs, *Transaction Isolation* — https://www.postgresql.org/docs/current/transaction-iso.html
- Stripe, *Designing robust and predictable APIs with idempotency* — https://stripe.com/blog/idempotency
- Google API Design Guide — https://cloud.google.com/apis/design ; Microsoft REST API Guidelines
- RFC 9457 (Problem Details for HTTP APIs) ; RFC 9110 (HTTP Semantics)
- Google SRE Book — https://sre.google/sre-book/table-of-contents/ (SLO, rollbacks, release engineering)
- OpenTelemetry — https://opentelemetry.io/docs/

## Principes retenus comme heuristiques (pas comme règles)

- **Les dépendances pointent vers le domaine** quand il existe une vraie logique métier. Pour un
  script ou un CRUD simple, des couches artificielles coûtent plus qu'elles ne rapportent.
- **Monolithe modulaire d'abord** ; découper en services seulement face à un besoin réel
  (équipes indépendantes, échelle hétérogène, isolement de pannes).
- **Une abstraction doit avoir au moins deux usages réels ou une frontière d'I/O à isoler.**
- **ADR** pour toute décision coûteuse à inverser : contexte, décision, conséquences, alternatives.

## Systèmes transactionnels — check-list de décision

| Propriété | Question à se poser | Réponse type |
|---|---|---|
| Atomicité | Que se passe-t-il si on échoue entre deux écritures ? | Transaction unique, ou outbox / saga si plusieurs systèmes |
| Cohérence | Quels invariants doivent toujours tenir ? | Contraintes en base (CHECK, FK, UNIQUE), pas seulement applicatives |
| Isolation | Deux requêtes concurrentes peuvent-elles violer l'invariant ? | Niveau d'isolation adapté, `SELECT … FOR UPDATE`, verrou optimiste (version) |
| Durabilité | Une écriture confirmée peut-elle être perdue ? | Confirmer après commit ; attention aux files en mémoire |
| Idempotence | Un retry duplique-t-il l'effet ? | Clé d'idempotence, contrainte d'unicité, upsert |
| Concurrence | Course check-then-act ? | Opération atomique en base, verrou, CAS |
| Rollback | Comment annuler un déploiement / une migration ? | Migrations expand/contract, réversibles, feature flags |
| Retry | Quelles erreurs sont transitoires ? | Backoff exponentiel + jitter, budget de retry, timeouts |
| Modèle de cohérence | Le lecteur tolère-t-il une donnée périmée ? | Forte pour l'argent/stock ; éventuelle acceptable pour les vues |

## API

- Contrat explicite (OpenAPI/GraphQL schema/protobuf), versionnement, erreurs structurées
  (RFC 9457), pagination, idempotence des POST sensibles, validation stricte des entrées,
  autorisation par ressource (BOLA est le risque n°1 de l'OWASP API Top 10).

## Conclusion pour le framework

- La skill `architecture` guide le *jugement* (quand une couche, quand un service, quand un ADR)
  au lieu d'imposer un style.
- Le routeur considère l'**impact architectural** comme facteur d'escalade vers Opus et de revue
  d'architecture ; les décisions sont tracées en ADR dans le Project Brain.
- Les domaines « argent », « migration », « concurrence » relèvent la profondeur de validation
  même en mode économique.
