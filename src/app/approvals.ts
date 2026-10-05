import { createHash } from 'node:crypto';
import { readVerdicts, extractAnswers, type AnswerVerdict } from '../domain/answers.js';
import { commandActionMaterial } from '../domain/action-key.js';
import { normalizePath } from '../domain/globs.js';
import type { ShellKind } from '../domain/shell.js';
import type { BrainStore } from '../brain/store.js';

/**
 * Validations humaines par l'invite de questions (AskUserQuestion), de la demande à l'exécution :
 *
 *  1. une action à valider est REFUSÉE par le hook, qui ouvre une demande à identifiant unique « R-xxxx »
 *     (jamais réutilisé) et dit à Claude comment poser la question ;
 *  2. l'humain répond ; le hook PostToolUse lit son choix RÉEL (l'identifiant doit figurer dans l'option choisie ;
 *     la formulation de la question est libre) : « Approuver R-xxxx » crée une autorisation, « Refuser R-xxxx » un refus ;
 *  3. Claude relance l'action. L'autorisation vaut 30 min pour la MÊME action (même clé : voir `actionKey`), relances
 *     après une erreur comprises — sauf opération destructive (`once`), consommée EXACTEMENT UNE FOIS : par PreToolUse,
 *     puis relayée à la boîte de permission native de la même exécution (règles `ask` de Claude Code) ;
 *  4. une autre action (autre commande à risque, autre fichier) ne profite jamais de l'autorisation.
 * Claude ne peut pas s'auto-approuver : seule la réponse réelle de l'humain crée une autorisation.
 */

export const GRANT_TTL_MS = 30 * 60_000;
const HANDOFF_TTL_MS = 2 * 60_000;
const REFUSAL_TTL_MS = 30 * 60_000;
const REQUEST_TTL_MS = 24 * 3_600_000;
const MAX_REQUESTS = 50;

export interface ApprovalRequest {
  id: string;
  key: string;
  what: string;
  reason: string;
  at: string;
  /** Opération destructive : l'autorisation sert une seule exécution. Absent (demande antérieure) : usage unique, par prudence. */
  once?: boolean;
}

export interface Grant {
  requestId: string;
  key: string;
  expiresAt: string;
  /** Usage unique (voir `ApprovalRequest.once`) ; sinon valable jusqu'à `expiresAt` pour la même action. */
  once?: boolean;
}

const FILE_TOOLS = ['file_path', 'notebook_path'] as const;

/**
 * Empreinte stable d'une action : la commande réduite à ce qui la fait agir (sans `cd … &&`, redirections, `| tail`,
 * espaces ; pour une commande composée, les sous-commandes à risque : voir `domain/action-key.ts`) ou le fichier visé
 * (outil indifférent : Edit, Write…). Une autorisation ne vaut que pour cette action.
 */
export function actionKey(tool: string, input: Record<string, unknown> | undefined): string {
  const command = input?.['command'];
  const file = FILE_TOOLS.map((k) => input?.[k]).find((v) => typeof v === 'string');
  let material: string;
  if (typeof command === 'string') material = `cmd\u0000${commandActionMaterial(command, shellOf(tool))}`;
  else if (typeof file === 'string') material = `file\u0000${normalizePath(file).toLowerCase()}`;
  else material = `${tool}\u0000${typeof input?.['url'] === 'string' ? input['url'] : JSON.stringify(input ?? {})}`;
  return createHash('sha256').update(material).digest('hex').slice(0, 24);
}

/** Syntaxe de la commande selon l'outil (guillemets et échappements de PowerShell ≠ bash). */
export const shellOf = (tool: string): ShellKind => (tool === 'PowerShell' ? 'powershell' : 'bash');

const isLive = (expiresAt: string): boolean => Date.parse(expiresAt) > Date.now();

/**
 * Utilise l'autorisation de cette action. Valable 30 min pour la même action (relances comprises) ; une autorisation à
 * usage unique (`once`, opération destructive) est consommée. Depuis PreToolUse (`relay`), une autorisation consommée
 * laisse un relais de 2 minutes pour la boîte de permission native de la même exécution (une autorisation qui reste
 * valable n'en a pas besoin : la boîte native la retrouve).
 */
export function consumeGrant(store: BrainStore, key: string, relay = true): Grant | undefined {
  let found: Grant | undefined;
  store.updateState((s) => {
    const grants = (s.grants ?? []).filter((g) => isLive(g.expiresAt));
    const i = grants.findIndex((g) => g.key === key);
    if (i >= 0) {
      found = grants[i]!;
      const single = found.once !== false;
      if (single) grants.splice(i, 1);
      if (relay && single) s.handoffs = [...(s.handoffs ?? []).filter((h) => isLive(h.expiresAt)), { key, requestId: found.requestId, expiresAt: new Date(Date.now() + HANDOFF_TTL_MS).toISOString() }];
    }
    s.grants = grants;
  });
  return found;
}

/** Relais d'une autorisation déjà consommée par PreToolUse (même exécution, vu par PermissionRequest). Usage unique. */
export function consumeHandoff(store: BrainStore, key: string): string | undefined {
  let requestId: string | undefined;
  store.updateState((s) => {
    const handoffs = (s.handoffs ?? []).filter((h) => isLive(h.expiresAt));
    const i = handoffs.findIndex((h) => h.key === key);
    if (i >= 0) {
      requestId = handoffs[i]!.requestId;
      handoffs.splice(i, 1);
    }
    s.handoffs = handoffs;
  });
  return requestId;
}

/** Refus récent de l'humain pour cette action (tant qu'il n'a pas écrit de nouveau message). */
export function findRefusal(store: BrainStore, key: string): string | undefined {
  const refusal = (store.state().refusals ?? []).find((r) => r.key === key && Date.now() - Date.parse(r.at) < REFUSAL_TTL_MS);
  return refusal?.requestId;
}

/** Un nouveau message de l'humain rouvre la discussion : les refus précédents ne bloquent plus. */
export function clearRefusals(store: BrainStore): void {
  if (!store.state().refusals?.length) return;
  store.updateState((s) => {
    delete s.refusals;
  });
}

/** Ouvre (ou réutilise) la demande en cours pour cette action. Les identifiants sont croissants et jamais réutilisés. */
export function openRequest(store: BrainStore, key: string, what: string, reason: string, once = false): ApprovalRequest {
  let request: ApprovalRequest | undefined;
  store.updateState((s) => {
    const open = (s.approvalRequests ?? []).filter((r) => Date.now() - Date.parse(r.at) < REQUEST_TTL_MS);
    request = open.find((r) => r.key === key);
    if (!request) {
      const highest = open.map((r) => Number.parseInt(r.id.slice(2), 10)).reduce((m, n) => Math.max(m, n), 0);
      const seq = Math.max(s.approvalSeq ?? 0, highest) + 1;
      s.approvalSeq = seq;
      request = { id: `R-${String(seq).padStart(4, '0')}`, key, what: what.replace(/\s+/g, ' ').trim().slice(0, 200), reason, at: new Date().toISOString(), once };
      open.push(request);
    }
    s.approvalRequests = open.slice(-MAX_REQUESTS);
  });
  return request!;
}

export interface AnswerOutcome {
  /** Demandes approuvées (autorisation créée). */
  approved: ApprovalRequest[];
  refused: ApprovalRequest[];
  /** Identifiants cités par l'humain qui ne correspondent à aucune demande ouverte (déjà utilisée, refusée ou expirée). */
  unknown: string[];
  /** Identifiants dont le choix n'a pas pu être interprété. */
  unclear: string[];
  /** Réponses lues (pour le journal de diagnostic). */
  verdicts: AnswerVerdict[];
}

/** Applique la réponse réelle de l'humain : approbation → autorisation (30 min, ou usage unique si destructive) ; refus → demande close + refus mémorisé. */
export function applyAnswers(store: BrainStore, toolResponse: unknown): AnswerOutcome {
  const verdicts = readVerdicts(extractAnswers(toolResponse));
  const outcome: AnswerOutcome = { approved: [], refused: [], unknown: [], unclear: [], verdicts };
  if (!verdicts.length) return outcome;
  store.updateState((s) => {
    const open = s.approvalRequests ?? [];
    const closed = new Set<string>();
    for (const v of verdicts) {
      const request = open.find((r) => r.id === v.id);
      if (!request) outcome.unknown.push(v.id);
      else if (v.decision === 'approve') {
        s.grants = [...(s.grants ?? []).filter((g) => g.key !== request.key), { requestId: request.id, key: request.key, expiresAt: new Date(Date.now() + GRANT_TTL_MS).toISOString(), once: request.once !== false }];
        outcome.approved.push(request);
        closed.add(request.id);
      } else if (v.decision === 'refuse') {
        s.grants = (s.grants ?? []).filter((g) => g.key !== request.key);
        s.refusals = [...(s.refusals ?? []).filter((r) => r.key !== request.key), { key: request.key, requestId: request.id, at: new Date().toISOString() }];
        outcome.refused.push(request);
        closed.add(request.id);
      } else outcome.unclear.push(v.id);
    }
    s.approvalRequests = open.filter((r) => !closed.has(r.id));
  });
  return outcome;
}

/** Consigne pour Claude après la réponse de l'humain (retour du hook PostToolUse) : dit exactement quoi faire ensuite. */
export function answerFeedback(outcome: AnswerOutcome): string | undefined {
  const lines: string[] = [];
  for (const r of outcome.approved) lines.push(`Approbation enregistrée pour ${r.id} (« ${r.what} ») : relance maintenant cette action ; ${grantScope(r)}`);
  for (const r of outcome.refused) lines.push(`Refus enregistré pour ${r.id} (« ${r.what} ») : n'exécute pas cette action et ne la redemande pas ; propose une alternative ou continue autre chose.`);
  for (const id of outcome.unknown) lines.push(`${id} ne correspond à aucune demande ouverte (déjà utilisée, refusée ou expirée) : relance l'action pour obtenir une nouvelle demande, puis pose la question avec le nouvel identifiant.`);
  for (const id of outcome.unclear) lines.push(`Réponse ambiguë pour ${id} : repose la question avec exactement les options « Approuver ${id} » et « Refuser ${id} ».`);
  return lines.length ? `[ceng] ${lines.join(' ')}` : undefined;
}

/** Portée d'une autorisation, dite à Claude (et donc à l'humain) en toutes lettres. */
function grantScope(r: ApprovalRequest): string {
  return r.once !== false
    ? `l'autorisation sert une seule exécution (opération destructive) et expire dans ${GRANT_TTL_MS / 60_000} min.`
    : `l'autorisation vaut ${GRANT_TTL_MS / 60_000} min pour cette même action (pas pour une autre) : tu peux la relancer après une erreur sans redemander.`;
}

/** Consigne pour Claude : demander la validation via l'invite (et non via une boîte de permission qui n'expire jamais). */
export function askViaInvite(request: ApprovalRequest): string {
  return (
    `Validation humaine requise — demande ${request.id}. ${request.reason}. Action : « ${request.what} ». ` +
    `Pose la question avec l'outil AskUserQuestion (formulation libre et brève : l'action et son enjeu) avec exactement deux options : « Approuver ${request.id} » et « Refuser ${request.id} ». ` +
    `Si l'humain choisit « Approuver ${request.id} », relance la même action (${request.once !== false ? `autorisation valable pour une seule exécution, ${GRANT_TTL_MS / 60_000} min` : `autorisation valable ${GRANT_TTL_MS / 60_000} min pour cette même action, relances comprises`}). ` +
    `S'il refuse, ne la relance pas. Si l'invite expire sans réponse, l'humain est absent : ne relance pas, continue autre chose.`
  );
}

/** Message renvoyé quand l'humain a refusé cette action. */
export function refusedMessage(requestId: string): string {
  return `Action refusée par l'humain (${requestId}) : ne la relance pas. Propose une alternative, ou attends un nouveau message de l'humain.`;
}
