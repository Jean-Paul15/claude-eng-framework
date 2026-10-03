import { APPROVAL_SUMMARY } from '../domain/guardrails.js';
import type { EffectivePolicy } from '../domain/types.js';
import type { ProjectProfile } from '../discovery/profile.js';
import { CLI_INVOCATION } from '../brain/paths.js';

export const BEGIN = '<!-- ceng:begin (généré par claude-eng-framework — modifié par `ceng init/upgrade`) -->';
export const END = '<!-- ceng:end -->';

/** Bloc court injecté dans CLAUDE.md : des pointeurs, pas un manuel (CLAUDE.md est chargé à chaque session). */
export function renderBlock(profile: ProjectProfile, policy: EffectivePolicy, codeGraph = false): string {
  const cmds = Object.entries(profile.commands)
    .filter(([k, v]) => v && ['build', 'typecheck', 'lint', 'unit', 'e2e'].includes(k))
    .map(([k, v]) => `${k}: \`${v}\``)
    .join(' · ');
  return [
    BEGIN,
    '## Framework d\'ingénierie (ceng)',
    '',
    `Ce dépôt est piloté par claude-eng-framework. Mémoire persistante : \`.ceng/brain/INDEX.md\` (lire d'abord, charger le reste à la demande).`,
    `Toute session reprend via le protocole de la skill \`ceng-orchestrate\` ; état machine via \`${CLI_INVOCATION} <commande>\` (jamais en éditant tasks.json/state.json à la main).`,
    '',
    `- Profil : ${profile.projectTypes.join(', ')} · ${profile.primaryLanguage ?? '?'} · ${profile.frameworks.slice(0, 6).join(', ') || 'sans framework'} · risque **${policy.riskLevel}**${policy.criticalDomains.length ? ` (critique : ${policy.criticalDomains.join(', ')})` : ''}`,
    `- Politique : budget ${policy.budget} · autonomie ${policy.autonomy} · parallélisme ${policy.parallelism} · orchestrateur ${policy.orchestratorModel}`,
    `- Commandes : ${cmds || 'voir .ceng/config.json'}`,
    ...(codeGraph || profile.codeGraph
      ? [`- Graphe de code : \`${profile.codeGraph?.path ?? 'graphify-out'}/\` (mis à jour automatiquement) — questions de structure (dépendances croisées, qui appelle X) → \`graphify query "…"\` d'abord ; grep/lecture ciblée pour le reste.`]
      : []),
    '- Déléguer : `route <tâche>` donne agent, modèle, effort, revue, gates. Les workers écrivent `.ceng/brain/reports/<tâche>.md` et renvoient un résumé court.',
    '- Terminé = gates requises vertes (`gate run <tâche>`) puis `task done`. Avant une modification risquée : `checkpoint`.',
    '- Légal & gouvernance : licences des dépendances, données personnelles, décisions tracées (ADR) — skill `legal-governance`.',
    '',
    '**Approbation humaine obligatoire** (quelle que soit l\'autonomie) :',
    ...APPROVAL_SUMMARY.map((s) => `- ${s}`),
    END,
  ].join('\n');
}

export function upsertBlock(existing: string | undefined, block: string): string {
  if (!existing || !existing.trim()) return `${block}\n`;
  const start = existing.indexOf(BEGIN.slice(0, 16));
  const end = existing.indexOf(END);
  if (start !== -1 && end !== -1 && end > start) {
    return `${existing.slice(0, start)}${block}${existing.slice(end + END.length)}`;
  }
  return `${existing.replace(/\s*$/, '')}\n\n${block}\n`;
}

export function removeBlock(existing: string): string {
  const start = existing.indexOf(BEGIN.slice(0, 16));
  const end = existing.indexOf(END);
  if (start === -1 || end === -1) return existing;
  return `${existing.slice(0, start).replace(/\s*$/, '')}\n${existing.slice(end + END.length).replace(/^\s*/, '')}`.trim() + '\n';
}
