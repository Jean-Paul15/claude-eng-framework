import type { BrainStore, ExternalIntent } from '../brain/store.js';
import { approvalTriggers } from '../domain/guardrails.js';
import type { ShellKind } from '../domain/shell.js';

/**
 * Journal d'intention des actions à effet extérieur (motif « loop breakpoint ») : une action qui sort de la machine
 * (déploiement, migration distante, publication, infrastructure, push) est consignée AVANT de s'exécuter et close
 * quand son résultat revient. Une session coupée entre les deux (limite d'usage, plantage, fermeture) laisse une
 * intention ouverte : la session suivante vérifie l'état réel au lieu de rejouer l'action à l'aveugle.
 */

/** Règles dont l'effet sort de la machine et ne se rattrape pas par un instantané local. */
const EXTERNAL_RULES = new Set(['deploy', 'prod-migrate', 'db-destructive', 'publish', 'infra-change', 'gh-destructive', 'git-force-push', 'git-push']);

/** Une intention plus vieille que ça n'apprend plus rien (l'humain a forcément vu le résultat entre-temps). */
export const INTENT_TTL_MS = 48 * 60 * 60_000;

/** Règles à effet extérieur déclenchées par une commande (indépendant du stade, du bypass et des autorisations). */
export function externalEffects(command: string, shell: ShellKind = 'bash'): string[] {
  return [...new Set(approvalTriggers(command, shell).map((t) => t.rule).filter((r) => EXTERNAL_RULES.has(r)))];
}

export function openIntent(store: BrainStore, command: string, rules: string[], sessionId?: string): void {
  const at = new Date().toISOString();
  store.updateState((s) => {
    const kept = (s.openIntents ?? []).filter((i) => i.command !== command && Date.now() - Date.parse(i.at) < INTENT_TTL_MS);
    s.openIntents = [...kept, { command: command.slice(0, 500), rules, at, ...(sessionId ? { sessionId } : {}) }];
  });
  store.log({ type: 'intent.open', ...(sessionId ? { sessionId } : {}), data: { command: command.slice(0, 300), rules } });
}

/** Clôt l'intention de cette commande (résultat reçu). Ne fait rien, sans écrire, s'il n'y en a pas. */
export function closeIntent(store: BrainStore, command: string, sessionId?: string): boolean {
  const open = store.state().openIntents ?? [];
  if (!open.some((i) => i.command === command.slice(0, 500))) return false;
  store.updateState((s) => {
    s.openIntents = (s.openIntents ?? []).filter((i) => i.command !== command.slice(0, 500));
  });
  store.log({ type: 'intent.done', ...(sessionId ? { sessionId } : {}), data: { command: command.slice(0, 300) } });
  return true;
}

/** Intentions restées sans résultat (récentes) : à vérifier avant toute relance. */
export function unresolvedIntents(store: BrainStore, now = Date.now()): ExternalIntent[] {
  return (store.state().openIntents ?? []).filter((i) => now - Date.parse(i.at) < INTENT_TTL_MS);
}
