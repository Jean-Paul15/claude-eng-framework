/**
 * Conseiller (« advisor ») de Claude Code : le modèle qui travaille consulte, côté serveur, un modèle plus fort au moment
 * des décisions. Règle officielle d'appariement : le conseiller doit se classer au moins au niveau du modèle principal,
 * sinon Claude Code ne l'attache pas. Source : https://code.claude.com/docs/en/advisor (fonction expérimentale).
 */

const RANK: Record<string, number> = { haiku: 0, sonnet: 1, opus: 2, fable: 3 };
const ALIAS = /^(fable|opus|sonnet)$/;
const FULL_ID = /^claude-(fable|opus|sonnet|haiku)-[\w.-]+$/;

export function isAdvisorModel(model: string): boolean {
  return ALIAS.test(model) || FULL_ID.test(model);
}

/** Famille d'un alias ou d'un identifiant complet (`claude-opus-5-5` → `opus`). */
export function family(model: string): string | undefined {
  return /(fable|opus|sonnet|haiku)/.exec(model)?.[1];
}

/** Le conseiller se classe-t-il au moins au niveau du modèle principal ? (même famille : vérifié par Claude Code selon la version) */
export function advisorOutranks(advisor: string, main: string): boolean {
  const a = RANK[family(advisor) ?? ''];
  const m = RANK[family(main) ?? ''];
  return a !== undefined && m !== undefined && a >= m;
}

/** Quand consulter : consigne courte donnée à l'orchestrateur (le moment est décidé par le modèle, pas par une règle de Claude Code). */
export const ADVISOR_GUIDANCE =
  "Conseiller actif : le consulter avant d'arrêter une architecture ou un schéma de données (avant l'ADR), après deux échecs sur la même tâche, " +
  "avant de déclarer terminée une tâche à risque ≥ 4 ou en domaine critique, et avant tout changement de contrat partagé. Pas pour les tâches courantes.";
