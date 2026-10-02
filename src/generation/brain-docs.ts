import type { EffectivePolicy } from '../domain/types.js';
import type { ProjectProfile } from '../discovery/profile.js';

const list = (items: readonly string[], empty = '_aucun_') => (items.length ? items.join(', ') : empty);

/** Profil technique détecté, lisible par un humain comme par un agent. */
export function renderProjectMd(p: ProjectProfile, policy: EffectivePolicy): string {
  const cmds = Object.entries(p.commands).filter(([, v]) => v).map(([k, v]) => `| ${k} | \`${v}\` |`);
  return `# Profil du projet — ${p.name}

<!-- Généré par \`ceng init\` (découverte statique). Les sections « Constat de l'orchestrateur » sont à compléter au bootstrap. -->

## Stack
- Types : ${list(p.projectTypes)} · UI : ${p.ui ? 'oui' : 'non'}
- Langages : ${list(p.languages.slice(0, 6).map((l) => `${l.name} (${l.files})`))}
- Gestionnaires : ${list(p.packageManagers)}
- Frameworks : ${list(p.frameworks.map((f) => (p.versions[f] ? `${f}@${p.versions[f]}` : f)))}
- Architecture : ${list(p.architecture.styles, 'non déterminée')}${p.architecture.monorepo ? ` · workspaces : ${list(p.architecture.workspaces)}` : ''}
- Répertoires racine : ${list(p.architecture.topLevelDirs.slice(0, 15))}

## Données & services
- Bases : ${list(p.databases)} · ORM : ${list(p.orm)} · migrations : ${list(p.migrations.map((m) => `${m.tool} (${m.path})`))}
- Services externes : ${list(p.services)}
- MCP du projet : ${p.mcp.file ? `${p.mcp.file} → ${list(p.mcp.servers)}` : '_aucun fichier .mcp.json_'}
- Infra : ${list(p.infra)} · Déploiement : ${list(p.deployment)}

## Qualité
- Tests : ${list(p.testing.frameworks)} · e2e : ${list(p.testing.e2e)} · fichiers de test : ${p.testing.testFiles}
- CI : ${list(p.ci.providers)}
- Lint : ${list(p.conventions.linters)} · format : ${list(p.conventions.formatters)} · types : ${list(p.conventions.typeCheckers)}${p.conventions.strictTypes ? ' (strict)' : ''}

| Gate | Commande détectée |
|---|---|
${cmds.join('\n') || '| — | aucune |'}

## Git
- Dépôt : ${p.git.isRepo ? 'oui' : 'non'} · branche par défaut : ${p.git.defaultBranch ?? '?'} · courante : ${p.git.currentBranch ?? '?'}
- Remotes : ${list(p.git.remotes)} · convention de commits : ${p.git.commitConvention} · branches protégées : ${list(p.git.protectedBranches)}

## Sécurité, légal, gouvernance
- Politique de sécurité : ${p.security.policy ? 'oui' : 'non'} · Dependabot/Renovate : ${p.security.dependabot || p.security.renovate ? 'oui' : 'non'} · CodeQL : ${p.security.codeql ? 'oui' : 'non'} · scan de secrets : ${p.security.secretScanning ? 'oui' : 'non'}
- Fichiers .env présents : ${list(p.security.envFilesPresent)} · .env.example : ${p.security.envExample ? 'oui' : 'non'}
- Licence : ${p.legal.license ?? '⚠ non déclarée'} · NOTICE : ${p.legal.notice ? 'oui' : 'non'} · CODEOWNERS : ${p.legal.codeowners ? 'oui' : 'non'} · politique de confidentialité : ${p.legal.privacyPolicy ? 'oui' : 'non'}

## Domaines et risque
- Risque inféré : **${p.riskLevel}** → retenu : **${policy.riskLevel}**
${p.domains.map((d) => `- ${d.name} — ${d.evidence}`).join('\n') || '- _aucun domaine sensible détecté_'}

## Politique effective
${policy.notes.map((n) => `- ${n}`).join('\n') || '- Préférences appliquées telles quelles.'}

## Constat de l'orchestrateur
_À compléter au bootstrap : ce que la détection statique ne peut pas voir (conventions implicites, zones fragiles, dette, contraintes métier)._
`;
}

export const OBJECTIVE_TEMPLATE = `# Objectif

_Non défini. Au premier lancement, l'orchestrateur demande la spécification à l'humain et la consigne ici :_

- **But** :
- **Utilisateurs** :
- **Périmètre (in / out)** :
- **Contraintes** (budget, délais, conformité, plateformes) :
- **Critères de succès mesurables** :
`;

export function architectureTemplate(p: ProjectProfile): string {
  return `# Architecture

## Constat (découverte statique)
- Styles détectés : ${p.architecture.styles.join(', ') || 'non déterminés'}
- Répertoires : ${p.architecture.topLevelDirs.slice(0, 15).join(', ') || '—'}

## Vue d'ensemble
_À compléter au bootstrap par l'orchestrateur (après lecture ciblée du code) : composants, frontières, flux de données, dépendances externes._

## Invariants à préserver
_Règles qui ne doivent jamais être violées (ex. « tout montant est en centimes entiers »)._

## Décisions
Voir \`decisions/\` (ADR).
`;
}
