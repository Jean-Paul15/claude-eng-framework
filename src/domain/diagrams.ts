import type { Task } from './types.js';

/**
 * Diagrammes UML obligatoires QUAND ils sont pertinents — jamais « pour la forme ». Ils portent ce que le code ne montre
 * pas d'un coup d'œil (un cycle de vie, un échange entre systèmes, un parcours, l'architecture des surfaces) ; tout le
 * reste (classes, objets, composants, cas d'utilisation…) est remplacé par le code, le schéma SQL et les contrats.
 * Écrits en Mermaid, à côté du code ou dans `docs/diagrams/`, mis à jour dans la tâche qui change ce qu'ils décrivent.
 */

export type DiagramKind = 'state' | 'sequence' | 'activity' | 'deployment';

export interface DiagramRequirement {
  kind: DiagramKind;
  why: string;
}

/** Domaines de tâche (déclarés à `task add --domains`) qui rendent un diagramme obligatoire. */
const TRIGGERS: { kind: DiagramKind; domains: string[]; why: string }[] = [
  { kind: 'state', domains: ['lifecycle', 'state-machine', 'workflow'], why: 'entité à cycle de vie (3 statuts ou plus) : diagramme d\'états' },
  { kind: 'sequence', domains: ['integration', 'webhooks', 'oauth', 'payments', 'dispatch'], why: 'échange entre systèmes (intégration, webhook, paiement, OAuth, répartition) : diagramme de séquence' },
  { kind: 'activity', domains: ['journey'], why: 'parcours utilisateur ou processus métier à étapes : diagramme d\'activité' },
  { kind: 'deployment', domains: ['multi-surface', 'architecture'], why: 'plusieurs surfaces ou services : diagramme de déploiement / architecture' },
];

export function requiredDiagrams(task: Pick<Task, 'domains' | 'kind'>): DiagramRequirement[] {
  if (['docs', 'test', 'research', 'chore'].includes(task.kind)) return [];
  return TRIGGERS.filter((t) => t.domains.some((d) => task.domains.includes(d))).map(({ kind, why }) => ({ kind, why }));
}

/** Mots-clés Mermaid qui attestent la présence d'un diagramme de ce type. */
const MERMAID: Record<DiagramKind, RegExp> = {
  state: /\bstateDiagram(-v2)?\b/,
  sequence: /\bsequenceDiagram\b/,
  activity: /\b(flowchart|graph)\s+(TD|TB|LR|RL|BT)\b|\bactivity\b/,
  deployment: /\b(architecture-beta|C4Deployment|C4Container|C4Context)\b/,
};

/** Types de diagrammes présents dans un texte (blocs ```mermaid, ou fichier .mmd entier). */
export function diagramsIn(text: string, isMermaidFile = false, file = ''): Set<DiagramKind> {
  const blocks = isMermaidFile ? [text] : [...text.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)].map((m) => m[1]!);
  const found = new Set<DiagramKind>();
  for (const b of blocks) for (const [kind, re] of Object.entries(MERMAID) as [DiagramKind, RegExp][]) if (re.test(b)) found.add(kind);
  // Un flowchart dans un document d'architecture ou de déploiement vaut schéma de déploiement.
  if (found.has('activity') && /architect|deploy|infra/i.test(file)) found.add('deployment');
  return found;
}

export const DIAGRAM_LABEL: Record<DiagramKind, string> = {
  state: 'états (stateDiagram-v2)',
  sequence: 'séquence (sequenceDiagram)',
  activity: 'activité (flowchart)',
  deployment: 'déploiement / architecture (architecture-beta, C4 ou flowchart)',
};
