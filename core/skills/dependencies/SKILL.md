---
name: dependencies
description: Choisir, vérifier et ajouter une dépendance (npm, pub, PyPI, Cargo, Go) — besoin réel, alternatives, licence, maintenance, vulnérabilités, usurpation de nom, poids, version épinglée. À utiliser avant tout ajout à un manifeste (package.json, pubspec.yaml, requirements.txt, pyproject.toml, Cargo.toml, go.mod) ou quand `ceng dep check` signale une dépendance.
---

# Choisir et vérifier une dépendance

Chaque dépendance est du code d'autrui exécuté avec les droits de l'application, mis à jour sans toi, et maintenu des
années. Le bon réflexe est de **ne pas en ajouter** tant qu'une solution plus simple existe.

## 1. Avant d'ajouter : en ai-je besoin ?
1. La bibliothèque standard, le framework ou une dépendance **déjà présente** le fait-il ? (`ceng similar <besoin>`, `ceng dep list`.)
2. Combien de lignes pour l'écrire proprement ? Moins de 30 lignes sans piège (dates, crypto, parsing, argent excepté) → les écrire.
3. Jamais pour : sécurité (crypto, authentification, hachage), paiement, parsing de formats complexes, dates et fuseaux — là,
   une bibliothèque reconnue bat le code maison.

## 2. Choisir entre candidats (en comparer deux au moins)
| Critère | Question | Où le voir |
|---|---|---|
| Maintenance | dernière publication, versions régulières, problèmes traités ? | `ceng dep check`, dépôt source |
| Usage | téléchargements, projets connus qui l'utilisent ? | `ceng dep check` |
| Licence | compatible avec la licence du projet et sa distribution (SaaS, application) ? | `ceng dep check` |
| Sécurité | vulnérabilités connues sur la version courante ? | `ceng dep check` |
| Poids | taille, nombre de dépendances transitives, scripts d'installation | page du paquet, `npm view <p> dependencies` |
| Fit | API stable (≥ 1.0), typée, tests, documentation à jour ? | dépôt source |
| Sortie | difficile à remplacer plus tard ? (verrouillage) | isoler derrière une petite interface si oui |

## 3. Vérifier — obligatoire
`ceng dep check <nom> [--eco npm|pypi|cargo|go|pub]` interroge les registres publics (deps.dev, pub.dev) : licence, dernière
publication, dépréciation, vulnérabilités connues, téléchargements. Sans nom, il vérifie toutes les dépendances ajoutées
sans vérification. Verdicts :
- ✔ **ok** : enregistré ; rien d'autre à faire.
- ⚠ **à examiner** : enregistré ; nomme la réserve dans le rapport (« maintenance incertaine, remplaçable par … »).
- ✖ **rejet** (déprécié, vulnérable, licence absente ou copyleft fort, introuvable) : choisir une alternative ; garder
  malgré tout seulement avec `--accept "raison"` — copyleft fort ou licence absente : décision de l'humain (skill `legal-governance`).
- « introuvable » : nom mal écrit ou **usurpation** (typosquatting) : ne jamais l'installer, relire le nom.
La gate `dependencies` bloque `task done` tant qu'une dépendance ajoutée n'est pas vérifiée ; le hook t'avertit dès l'écriture du manifeste.

## 4. Ajouter proprement
- Version précise et verrou (`package-lock.json`, `pubspec.lock`, `poetry.lock`, `Cargo.lock`, `go.sum`) **versionné** ; installation
  avec l'outil du projet, jamais un `curl | sh` ni un paquet venu d'une URL ou d'un dépôt git non épinglé.
- Dépendance de développement ou de test séparée de celle de production.
- Une dépendance par besoin ; pas de « kit complet » pour une seule fonction.
- Nouveau tiers qui reçoit des données (SDK d'analyse, d'erreurs, de paiement) : décision de l'humain, mention dans la politique
  de confidentialité (skill `legal-governance`).
- Rapport de la tâche : pour chaque ajout, pourquoi, ce qui a été écarté, licence, verdict.

## 5. Retirer et mettre à jour
Une dépendance devenue inutile est retirée dans la même tâche que ce qui la remplace (skill `software-engineering`). Mise à jour :
`audit` de l'écosystème (`deps-audit` dans les gates) ; une montée de version majeure est une tâche à part, avec ses tests.
