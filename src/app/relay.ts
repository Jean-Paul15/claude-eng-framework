import * as fs from 'node:fs';
import * as path from 'node:path';
import { run } from '../infra/exec.js';

/**
 * Relais entre sessions : un canal d'événements ajouté en fin de fichier, lu sans coût de jetons.
 *
 * Plusieurs sessions travaillent dans des copies de travail (worktrees) d'un même dépôt. Une session qui atteint un point d'arrêt
 * (par exemple « prêt pour Opus ») ÉMET un événement ; la session de coordination l'attend avec `ceng relay watch`, branché sur
 * l'outil Monitor de Claude Code : chaque ligne émise réveille la coordination immédiatement, et rien n'est lu ni payé tant que
 * rien ne se passe. Le fichier d'événements est toujours dans le dépôt PRINCIPAL (pas dans la copie de travail), pour que toutes
 * les sessions écrivent au même endroit.
 */

export type RelayKind = 'opus-ready' | 'opus-done' | 'blocked' | 'decision-needed' | 'custom';

export const RELAY_KINDS: readonly RelayKind[] = ['opus-ready', 'opus-done', 'blocked', 'decision-needed', 'custom'];

export interface RelayEvent {
  seq: number;
  at: string;
  kind: RelayKind;
  /** Session qui émet (nom court ou numéro). */
  session: string;
  /** Fichier de contexte à lire (par exemple le dossier d'intégration d'une page), relatif au dépôt. */
  ref?: string;
  note?: string;
}

/** Racine du dépôt principal : celle qui contient le dossier `.git` commun à toutes les copies de travail. */
export function mainRoot(projectRoot: string): string {
  const r = run('git', ['rev-parse', '--git-common-dir'], { cwd: projectRoot, timeoutMs: 15_000 });
  if (r.code !== 0) return path.resolve(projectRoot);
  const common = path.resolve(projectRoot, r.stdout.trim());
  return path.basename(common) === '.git' ? path.dirname(common) : path.resolve(projectRoot);
}

export function relayDir(projectRoot: string): string {
  return path.join(mainRoot(projectRoot), '.ceng', 'relay');
}

const eventsFile = (projectRoot: string) => path.join(relayDir(projectRoot), 'events.jsonl');
const cursorFile = (projectRoot: string, reader: string) => path.join(relayDir(projectRoot), `cursor-${reader.replace(/[^a-z0-9_-]/gi, '_')}.json`);

function readAll(projectRoot: string): RelayEvent[] {
  const file = eventsFile(projectRoot);
  if (!fs.existsSync(file)) return [];
  const events: RelayEvent[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as RelayEvent;
      if (typeof e.seq === 'number' && typeof e.kind === 'string') events.push(e);
    } catch {
      // ligne écrite en cours ou abîmée : ignorée, jamais bloquante
    }
  }
  return events;
}

export function emitRelayEvent(projectRoot: string, input: { kind: RelayKind; session: string; ref?: string; note?: string }): RelayEvent {
  const dir = relayDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });
  const last = readAll(projectRoot).at(-1)?.seq ?? 0;
  const event: RelayEvent = {
    seq: last + 1,
    at: new Date().toISOString(),
    kind: input.kind,
    session: input.session,
    ...(input.ref ? { ref: input.ref } : {}),
    ...(input.note ? { note: input.note.slice(0, 500) } : {}),
  };
  fs.appendFileSync(eventsFile(projectRoot), `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

export function relayEvents(projectRoot: string, sinceSeq = 0): RelayEvent[] {
  return readAll(projectRoot).filter((e) => e.seq > sinceSeq);
}

function readCursor(projectRoot: string, reader: string): number {
  try {
    const c = JSON.parse(fs.readFileSync(cursorFile(projectRoot, reader), 'utf8')) as { seq?: number };
    return typeof c.seq === 'number' ? c.seq : 0;
  } catch {
    return 0;
  }
}

/** Marque les événements jusqu'à `seq` comme traités par ce lecteur : ils ne seront plus renvoyés. */
export function ackRelay(projectRoot: string, reader: string, seq: number): void {
  fs.mkdirSync(relayDir(projectRoot), { recursive: true });
  fs.writeFileSync(cursorFile(projectRoot, reader), JSON.stringify({ seq, at: new Date().toISOString() }), 'utf8');
}

/** Événements pas encore traités par ce lecteur (le curseur n'avance que quand on le demande ou en mode watch). */
export function pendingRelay(projectRoot: string, reader: string): RelayEvent[] {
  return relayEvents(projectRoot, readCursor(projectRoot, reader));
}

/** Action recommandée à la coordination pour un événement (texte court, une consigne par ligne). */
export function suggestedAction(e: RelayEvent): string {
  switch (e.kind) {
    case 'opus-ready':
      return `Passer la session « ${e.session} » sur Opus (set_session_model), puis lui écrire : « Lis ${e.ref ?? "ton dossier d'intégration"} et exécute le point d'arrêt. »`;
    case 'opus-done':
      return `Repasser la session « ${e.session} » sur Sonnet (set_session_model) ; lire le verdict dans ${e.ref ?? 'son dossier'}.`;
    case 'blocked':
      return `La session « ${e.session} » est bloquée${e.note ? ` : ${e.note}` : ''}. Regarder ${e.ref ?? 'son état'}, débloquer ou prévenir le fondateur.`;
    case 'decision-needed':
      return `La session « ${e.session} » attend une décision du fondateur${e.note ? ` : ${e.note}` : ''}. Le lui présenter simplement.`;
    default:
      return `Événement « ${e.kind} » de la session « ${e.session} »${e.note ? ` : ${e.note}` : ''}.`;
  }
}

export interface WatchOptions {
  reader: string;
  intervalMs: number;
  /** Rejouer les événements déjà là au démarrage (sinon : seulement les nouveaux). */
  replay?: boolean;
  onEvent: (e: RelayEvent) => void;
  /** Pour les tests : arrêt propre. */
  signal?: AbortSignal;
}

/** Boucle d'attente : appelle `onEvent` pour chaque nouvel événement, puis avance le curseur. Silencieuse tant qu'il n'y a rien. */
export async function watchRelay(projectRoot: string, opts: WatchOptions): Promise<void> {
  let cursor = opts.replay ? readCursor(projectRoot, opts.reader) : Math.max(readCursor(projectRoot, opts.reader), readAll(projectRoot).at(-1)?.seq ?? 0);
  ackRelay(projectRoot, opts.reader, cursor);
  while (!opts.signal?.aborted) {
    for (const e of relayEvents(projectRoot, cursor)) {
      opts.onEvent(e);
      cursor = e.seq;
      ackRelay(projectRoot, opts.reader, cursor);
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }
}
