import { createHash } from 'node:crypto';
import { nextId } from '../domain/taskgraph.js';
import type { BrainStore } from '../brain/store.js';
import { isUnattended } from './unattended.js';

/**
 * Présence de l'humain et validations par l'invite de questions.
 *
 * Claude Code n'expire jamais une demande de permission, mais son invite de questions (AskUserQuestion) peut
 * expirer (réglage utilisateur `askUserQuestionTimeout`). Le framework fait donc passer les validations par l'invite :
 *  - action à valider → refusée avec un identifiant R-xxxx, Claude pose la question « Approuver R-xxxx / Refuser R-xxxx » ;
 *  - l'humain répond « Approuver » → le hook PostToolUse lit SA réponse et crée une autorisation à usage unique ;
 *  - Claude relance l'action → autorisée (Claude ne peut pas s'auto-approuver : seule la réponse réelle crée l'autorisation) ;
 *  - l'invite expire sans réponse → humain absent : bascule en mode sans humain (rien n'est plus affiché, tout est
 *    consigné) jusqu'à son prochain message.
 */

export const GRANT_TTL_MS = 30 * 60_000;
export const QUESTION_TIMEOUT = '10m';

export interface ApprovalRequest {
  id: string;
  key: string;
  what: string;
  reason: string;
  at: string;
}

export interface Grant {
  requestId: string;
  key: string;
  expiresAt: string;
}

export function presenceEnabled(store: BrainStore): boolean {
  return store.config().presence?.enabled ?? true;
}

/** Absent = mode nuit explicite, ou une invite a expiré sans réponse depuis le dernier message de l'humain. */
export function isHumanAway(store: BrainStore): boolean {
  if (isUnattended()) return true;
  if (!presenceEnabled(store)) return false;
  const s = store.state();
  return Boolean(s.humanAwaySignalAt && (!s.lastHumanAt || s.humanAwaySignalAt > s.lastHumanAt));
}

export function markHumanActive(store: BrainStore, prompt: string, sessionId?: string): void {
  store.updateState((s) => {
    s.lastHumanAt = new Date().toISOString();
    delete s.humanAwaySignalAt;
    delete s.unattended;
    if (/\/ceng-orchestrate\b/.test(prompt) && sessionId) s.autopilotSessionId = sessionId;
  });
}

export function markHumanAway(store: BrainStore): void {
  store.updateState((s) => {
    s.humanAwaySignalAt = new Date().toISOString();
  });
}

export function markAutopilot(store: BrainStore, sessionId?: string): void {
  if (!sessionId) return;
  store.updateState((s) => {
    s.autopilotSessionId = sessionId;
  });
}

/** Empreinte stable d'une action (outil + cible) : une autorisation ne vaut que pour cette action exacte. */
export function actionKey(tool: string, input: Record<string, unknown> | undefined): string {
  const target = String(input?.['command'] ?? input?.['file_path'] ?? input?.['notebook_path'] ?? input?.['url'] ?? JSON.stringify(input ?? {}));
  return createHash('sha256').update(`${tool}\u0000${target.trim()}`).digest('hex').slice(0, 24);
}

/** Consomme une autorisation valide pour cette action (usage unique). */
export function consumeGrant(store: BrainStore, key: string): Grant | undefined {
  let found: Grant | undefined;
  store.updateState((s) => {
    const now = Date.now();
    const grants = (s.grants ?? []).filter((g) => Date.parse(g.expiresAt) > now);
    const i = grants.findIndex((g) => g.key === key);
    if (i >= 0) {
      found = grants[i];
      grants.splice(i, 1);
    }
    s.grants = grants;
  });
  return found;
}

/** Ouvre (ou réutilise) une demande de validation pour cette action. */
export function openRequest(store: BrainStore, key: string, what: string, reason: string): ApprovalRequest {
  let request: ApprovalRequest | undefined;
  store.updateState((s) => {
    const pending = s.approvalRequests ?? [];
    request = pending.find((r) => r.key === key);
    if (!request) {
      request = { id: nextId('R', pending.map((r) => r.id)), key, what: what.slice(0, 200), reason, at: new Date().toISOString() };
      s.approvalRequests = [...pending.slice(-49), request];
    }
  });
  return request!;
}

/**
 * Lit la réponse de l'humain à une invite : « Approuver R-0003 » crée une autorisation à usage unique,
 * « Refuser R-0003 » clôt la demande. Renvoie les identifiants traités.
 */
export function applyAnswers(store: BrainStore, responseText: string): { approved: string[]; refused: string[] } {
  const approved = [...responseText.matchAll(/Approuver\s+(R-\d{4})/g)].map((m) => m[1]!);
  const refused = [...responseText.matchAll(/Refuser\s+(R-\d{4})/g)].map((m) => m[1]!);
  if (!approved.length && !refused.length) return { approved, refused };
  store.updateState((s) => {
    const pending = s.approvalRequests ?? [];
    const expiresAt = new Date(Date.now() + GRANT_TTL_MS).toISOString();
    for (const id of approved) {
      const r = pending.find((x) => x.id === id);
      if (r) s.grants = [...(s.grants ?? []), { requestId: id, key: r.key, expiresAt }];
    }
    s.approvalRequests = pending.filter((r) => !approved.includes(r.id) && !refused.includes(r.id));
  });
  return { approved, refused };
}

/** Consigne pour Claude : demander la validation via l'invite (et non via une boîte de permission qui n'expire pas). */
export function askViaInvite(request: ApprovalRequest): string {
  return (
    `Validation humaine requise (${request.reason}). Pose la question avec l'outil AskUserQuestion — question « ${request.what} » ` +
    `avec exactement les options « Approuver ${request.id} » et « Refuser ${request.id} » (explique brièvement l'enjeu) — puis, ` +
    `si l'humain approuve, relance exactement la même action. Si l'invite expire sans réponse, ne relance pas : l'humain est absent, continue autre chose.`
  );
}
