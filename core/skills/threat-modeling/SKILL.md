---
name: threat-modeling
description: Modélisation de menaces légère et proportionnée (4 questions du Threat Modeling Manifesto, STRIDE sur le flux) avant d'implémenter une fonctionnalité sensible — produit des mesures exigées et des tests d'abus concrets. À utiliser pour auth, paiements, données personnelles, multi-tenant, uploads, webhooks, intégrations externes, IA exposée.
---

# Threat modeling — 20 minutes, pas 20 pages

Les 4 questions : **Sur quoi travaille-t-on ? Qu'est-ce qui peut mal tourner ? Que fait-on contre ? A-t-on bien fait ?**

## Procédure
1. **Flux** (5-10 lignes) : acteurs, données, composants, et les **frontières de confiance** franchies
   (navigateur → API, API → BD, service → tiers, webhook entrant).
2. **Actifs** : ce qui a de la valeur (argent, données personnelles, comptes, disponibilité, réputation).
3. **Menaces STRIDE** par frontière, seulement les plausibles :
   Spoofing (usurpation) · Tampering (altération) · Repudiation (déni) · Information disclosure (fuite) ·
   Denial of service · Elevation of privilege.
   Ajouter les **abus métier** : rejouer une requête, course sur un solde, contourner un état de workflow,
   énumération, coût (appels IA/SMS illimités).
4. **Mesures** : pour chaque menace retenue, la mesure et où elle s'applique (code, BD, infra, processus).
5. **Tests d'abus** : chaque mesure importante → un test qui tente l'attaque et doit échouer.
6. **Risques acceptés** : listés explicitement, avec qui les accepte (l'humain pour les risques élevés).

## Livrable
`.ceng/brain/reports/<TÂCHE>-threats.md` : flux, actifs, tableau menace → mesure → test, risques acceptés.
Court. Les tests d'abus deviennent des critères d'acceptation de la tâche d'implémentation.
