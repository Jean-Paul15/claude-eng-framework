/**
 * Lecture de la réponse réelle de l'humain à l'invite de questions (AskUserQuestion), tolérante à la forme du résultat
 * d'outil et à la reformulation des options : seule compte l'option CHOISIE, repérée par son identifiant R-xxxx.
 */

export type AnswerDecision = 'approve' | 'refuse' | 'unclear';

export interface AnswerVerdict {
  id: string;
  decision: AnswerDecision;
  /** Réponse brute (tronquée) dont la décision a été tirée. */
  answer: string;
}

const REQUEST_ID = /R-\d{4}/g;
const APPROVE_FIRST = /^(?:approuv\w*|accept\w*|autoris\w*|valid\w*|oui|yes|ok|approve\w*|allow\w*|go)\b/i;
const REFUSE_FIRST = /^(?:refus\w*|rejet\w*|non|no|deny|denied|reject\w*|annul\w*|cancel\w*|bloqu\w*|ne\s+pas)\b/i;
const APPROVE_ANY = /\b(?:approuv\w*|approve\w*|autoris\w*|accept\w*|valid\w*|allow\w*|oui|yes)\b/i;
const REFUSE_ANY = /\b(?:refus\w*|rejet\w*|reject\w*|deny|denied|annul\w*|cancel\w*)\b/i;

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectStrings(v, out);
}

/** Texte brut d'un résultat d'outil : `"question"="réponse"` → on ne garde que les réponses ; sinon tout le texte. */
function answersFromText(text: string): string[] {
  const pairs = [...text.matchAll(/"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[2]!);
  return pairs.length ? pairs : [text];
}

/**
 * Réponses données par l'humain. Forme structurée (`{ answers: { question: choix } }`) : seules les valeurs comptent
 * (les questions et la liste des options contiennent les deux identifiants « Approuver » et « Refuser »).
 */
export function extractAnswers(toolResponse: unknown): string[] {
  if (toolResponse && typeof toolResponse === 'object' && !Array.isArray(toolResponse) && 'answers' in toolResponse) {
    const out: string[] = [];
    collectStrings((toolResponse as { answers: unknown }).answers, out);
    return out;
  }
  if (typeof toolResponse === 'string') return answersFromText(toolResponse);
  const texts: string[] = [];
  collectStrings(toolResponse, texts);
  return texts.flatMap(answersFromText);
}

function decide(answer: string): AnswerDecision {
  const head = answer.replace(/^[^\p{L}]+/u, '');
  if (REFUSE_FIRST.test(head)) return 'refuse';
  if (APPROVE_FIRST.test(head)) return 'approve';
  if (REFUSE_ANY.test(answer)) return 'refuse';
  return APPROVE_ANY.test(answer) ? 'approve' : 'unclear';
}

/** Décision par identifiant de demande. En cas de contradiction sur un même identifiant, le refus l'emporte. */
export function readVerdicts(answers: readonly string[]): AnswerVerdict[] {
  const byId = new Map<string, AnswerVerdict>();
  for (const answer of answers) {
    const ids = new Set(answer.match(REQUEST_ID) ?? []);
    for (const id of ids) {
      const verdict: AnswerVerdict = { id, decision: decide(answer), answer: answer.slice(0, 160) };
      const known = byId.get(id);
      if (!known || verdict.decision === 'refuse' || (known.decision === 'unclear' && verdict.decision === 'approve')) byId.set(id, verdict);
    }
  }
  return [...byId.values()];
}

/** L'invite s'est refermée sans réponse (délai dépassé) : l'humain est absent. Une vraie réponse prime toujours. */
export function isTimeout(toolResponse: unknown): boolean {
  if (toolResponse && typeof toolResponse === 'object' && !Array.isArray(toolResponse) && 'answers' in toolResponse) {
    const given: string[] = [];
    collectStrings((toolResponse as { answers: unknown }).answers, given);
    if (given.some((a) => a.trim())) return false;
  }
  const texts: string[] = [];
  collectStrings(toolResponse, texts);
  const text = typeof toolResponse === 'string' ? answersFromText(toolResponse).join(' ') : texts.join(' ');
  return /away from (?:the |your |their )?keyboard|may be away|auto-?continue|timed out waiting|question (?:timed out|timeout)/i.test(text);
}
