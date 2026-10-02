import type { ProjectProfile } from '../discovery/profile.js';

/**
 * Skills spécifiques au projet, générées quand la découverte identifie un besoin
 * (service critique, plateforme principale). Le contenu vient de `core/project-skills.json`
 * (extensible sans toucher au code) enrichi par ce qui a été détecté ; la skill est marquée
 * « draft » jusqu'à ce que l'orchestrateur la complète par recherche documentaire.
 */

export interface ProjectSkillTemplate {
  name: string;
  description: string;
  match: { services?: string[]; frameworks?: string[]; databases?: string[]; projectTypes?: string[]; deps?: string[] };
  focus: string[];
  checklist: string[];
  pitfalls: string[];
  docs: string[];
  research: string[];
}

/**
 * Chaîne YAML sûre : une chaîne JSON est un scalaire YAML double-quoté valide. Évite qu'un « : » ou
 * un « # » dans une description rende le frontmatter invalide (la skill serait alors ignorée).
 */
export function yamlString(value: string): string {
  return JSON.stringify(value.replace(/\r?\n/g, ' '));
}

export function matchTemplates(templates: readonly ProjectSkillTemplate[], profile: ProjectProfile): ProjectSkillTemplate[] {
  return templates.filter((t) => {
    const m = t.match;
    return (
      (m.services ?? []).some((s) => profile.services.includes(s)) ||
      (m.frameworks ?? []).some((f) => profile.frameworks.includes(f)) ||
      (m.databases ?? []).some((d) => profile.databases.includes(d)) ||
      (m.projectTypes ?? []).some((pt) => profile.projectTypes.includes(pt as never))
    );
  });
}

function evidenceFor(t: ProjectSkillTemplate, profile: ProjectProfile): string[] {
  const out: string[] = [];
  for (const s of t.match.services ?? []) if (profile.services.includes(s)) out.push(`service ${s}`);
  for (const f of t.match.frameworks ?? []) if (profile.frameworks.includes(f)) out.push(`framework ${f}${profile.versions[f] ? ` ${profile.versions[f]}` : ''}`);
  for (const d of t.match.databases ?? []) if (profile.databases.includes(d)) out.push(`base ${d}`);
  for (const pt of t.match.projectTypes ?? []) if (profile.projectTypes.includes(pt as never)) out.push(`type de projet ${pt}`);
  return out;
}

export function renderProjectSkill(t: ProjectSkillTemplate, profile: ProjectProfile, date: string): string {
  const cmds = Object.entries(profile.commands).filter(([, v]) => v).map(([k, v]) => `- ${k} : \`${v}\``);
  const list = (items: string[]) => items.map((i) => `- ${i}`).join('\n');
  return `---
name: ${t.name}
description: ${yamlString(t.description)}
metadata:
  ceng-tier: project
  ceng-status: draft
  ceng-generated: "${date}"
---

# ${t.name}

> Brouillon généré par \`ceng init\` à partir de la découverte du projet. **Statut : draft.**
> Avant de s'appuyer sur une affirmation de version ou d'API, la vérifier dans la documentation
> officielle (section « Recherche à compléter »), puis passer \`ceng-status\` à \`verified\`
> via la skill \`ceng-skill-forge\`.

## Pourquoi cette skill existe
Détecté : ${evidenceFor(t, profile).join(', ') || 'n/a'}.

## Points d'attention de ce domaine
${list(t.focus)}

## Check-list avant de déclarer une tâche terminée
${list(t.checklist)}

## Pièges fréquents
${list(t.pitfalls)}

## Commandes du projet
${cmds.join('\n') || '- (aucune commande détectée)'}

## Documentation officielle
${list(t.docs)}

## Recherche à compléter (bootstrap)
${list(t.research)}
`;
}
