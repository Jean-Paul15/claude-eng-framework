import type { BrainStore } from '../brain/store.js';
import { isUnattended } from './unattended.js';

/**
 * Présence de l'humain.
 *
 * Claude Code n'expire jamais une demande de permission, mais son invite de questions (AskUserQuestion) peut
 * expirer (réglage utilisateur `askUserQuestionTimeout`). L'humain est donc considéré :
 *  - PRÉSENT dès qu'il écrit un message ou répond à une invite ;
 *  - ABSENT quand une invite expire sans réponse, jusqu'à son prochain message ;
 *  - ABSENT en mode nuit explicite (CENG_UNATTENDED=1), SAUF s'il écrit un vrai message pendant la session
 *    (le message de lancement de `ceng run --unattended` ne compte pas) : un message récent le rend présent.
 * Les validations elles-mêmes (demandes, autorisations) sont dans approvals.ts.
 */

/** En mode nuit, un message de l'humain de moins de ce délai le rend présent (au-delà, il est reparti). */
export const PRESENCE_WINDOW_MS = 15 * 60_000;
export const QUESTION_TIMEOUT = '10m';

/** Marqueur du message de lancement de `ceng run --unattended` : il ne prouve pas la présence d'un humain. */
const LAUNCH_PROMPT = /MODE SANS HUMAIN/;

export function presenceEnabled(store: BrainStore): boolean {
  return store.config().presence?.enabled ?? true;
}

function wroteRecently(lastHumanAt: string | undefined): boolean {
  return Boolean(lastHumanAt && Date.now() - Date.parse(lastHumanAt) < PRESENCE_WINDOW_MS);
}

/** Absent = mode nuit sans message récent, ou une invite a expiré sans réponse depuis le dernier signe de vie de l'humain. */
export function isHumanAway(store: BrainStore): boolean {
  const s = store.state();
  if (isUnattended()) return !wroteRecently(s.lastHumanAt);
  if (!presenceEnabled(store)) return false;
  return Boolean(s.humanAwaySignalAt && (!s.lastHumanAt || s.humanAwaySignalAt > s.lastHumanAt));
}

/** UserPromptSubmit : l'humain est là ; /ceng-orchestrate active le pilote automatique. Renvoie false quand le message n'est pas d'un humain (message de lancement du mode nuit). */
export function markHumanActive(store: BrainStore, prompt: string, sessionId?: string): boolean {
  if (isUnattended() && LAUNCH_PROMPT.test(prompt)) return false;
  store.updateState((s) => {
    s.lastHumanAt = new Date().toISOString();
    delete s.humanAwaySignalAt;
    delete s.unattended;
    if (/\/ceng-orchestrate\b/.test(prompt) && sessionId) s.autopilotSessionId = sessionId;
  });
  return true;
}

/** Une réponse réelle à une invite prouve la présence, comme un message. */
export function markHumanAnswered(store: BrainStore): void {
  store.updateState((s) => {
    s.lastHumanAt = new Date().toISOString();
    delete s.humanAwaySignalAt;
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
