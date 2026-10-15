import * as path from 'node:path';
import { ackRelay, emitRelayEvent, mainRoot, pendingRelay, RELAY_KINDS, relayEvents, suggestedAction, watchRelay, type RelayEvent, type RelayKind } from '../../app/relay.js';
import { BrainStore } from '../../brain/store.js';
import { bool, out, parse, requireStr, str, UsageError } from '../args.js';

/**
 * `ceng team on|off|status` — mode « équipe autonome » : le framework tranche les demandes de permission à la place d'un humain absent,
 * selon une liste de sécurité fermée (voir src/domain/team.ts). Activer ou couper ce mode change le niveau des garde-fous : action
 * humaine, la garde de commandes la soumet à l'approbation (l'agent ne peut pas se l'accorder).
 */
export function teamCommand(argv: string[]): void {
  const [sub, ...rest] = argv;
  const p = parse(rest, { dir: { type: 'string' }, allow: { type: 'string', multiple: true }, defer: { type: 'string', multiple: true } });
  const store = new BrainStore(path.resolve(str(p, 'dir') ?? process.cwd()));
  store.requireInitialized();
  const config = store.config();
  const current = config.team ?? { enabled: false };
  switch (sub ?? 'status') {
    case 'status': {
      const text = current.enabled
        ? `Équipe autonome : ACTIVÉE. Autorisés d'office : lecture, recherche, coordination entre sessions, outils locaux, commandes classées autonomes. Refusés et consignés pour l'humain (.ceng/brain/pending-approvals.md) : base de production, déploiement, e-mail, paiement, secrets, changement de mode de permission.${current.mcpAllow?.length ? `\n  Outils MCP autorisés en plus : ${current.mcpAllow.join(', ')}` : ''}${current.mcpDefer?.length ? `\n  Outils MCP toujours refusés : ${current.mcpDefer.join(', ')}` : ''}`
        : 'Équipe autonome : désactivée (les permissions suivent le stade du projet et la présence de l\'humain).';
      out(p, text, { team: current });
      return;
    }
    case 'on': {
      const allow = (p.values['allow'] as string[] | undefined) ?? current.mcpAllow ?? [];
      const defer = (p.values['defer'] as string[] | undefined) ?? current.mcpDefer ?? [];
      store.saveConfig({ ...config, team: { enabled: true, ...(allow.length ? { mcpAllow: allow } : {}), ...(defer.length ? { mcpDefer: defer } : {}) } });
      store.log({ type: 'guard.verdict', data: { class: 'team-mode', enabled: true } });
      out(p, 'Équipe autonome activée. Les permissions sont désormais tranchées par la liste de sécurité du framework ; ce qui touche aux secrets, à la production, aux paiements ou à la publication est refusé et consigné pour toi, sans jamais attendre.', { team: { enabled: true, allow, defer } });
      return;
    }
    case 'off': {
      store.saveConfig({ ...config, team: { enabled: false } });
      store.log({ type: 'guard.verdict', data: { class: 'team-mode', enabled: false } });
      out(p, 'Équipe autonome désactivée.', { team: { enabled: false } });
      return;
    }
    default:
      throw new UsageError('Usage : ceng team status|on|off [--allow mcp__serveur__outil]… [--defer mcp__serveur__outil]… [--dir <projet>]');
  }
}

const KIND_LIST = RELAY_KINDS.join('|');

function line(e: RelayEvent, mode: 'json' | 'human'): string {
  return mode === 'json'
    ? JSON.stringify({ ...e, action: suggestedAction(e) })
    : `[relais #${e.seq}] ${e.kind} · session ${e.session}${e.ref ? ` · ${e.ref}` : ''}${e.note ? ` · ${e.note}` : ''}\n  → ${suggestedAction(e)}`;
}

/**
 * `ceng relay emit|watch|events|ack` — canal d'événements entre sessions, sans coût de jetons.
 *   emit  : une session signale un point d'arrêt (par exemple `--kind opus-ready --session 4 --ref docs/rpg/integration/DOSSIER_4_1.md`)
 *   watch : la coordination attend ; UNE ligne par nouvel événement (à brancher sur l'outil Monitor : chaque ligne la réveille)
 *   events: liste (les événements non traités par défaut, tous avec --all)
 *   ack   : marque les événements comme traités
 */
export async function relayCommand(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  const p = parse(rest, {
    dir: { type: 'string' }, kind: { type: 'string' }, session: { type: 'string' }, ref: { type: 'string' }, note: { type: 'string' },
    reader: { type: 'string' }, interval: { type: 'string' }, replay: { type: 'boolean' }, all: { type: 'boolean' }, human: { type: 'boolean' }, upto: { type: 'string' },
  });
  const root = path.resolve(str(p, 'dir') ?? process.cwd());
  const reader = str(p, 'reader') ?? 'coordination';
  switch (sub) {
    case 'emit': {
      const kind = requireStr(p, 'kind', KIND_LIST) as RelayKind;
      if (!RELAY_KINDS.includes(kind)) throw new UsageError(`--kind doit valoir : ${KIND_LIST}.`);
      const e = emitRelayEvent(root, { kind, session: requireStr(p, 'session'), ...(str(p, 'ref') ? { ref: str(p, 'ref')! } : {}), ...(str(p, 'note') ? { note: str(p, 'note')! } : {}) });
      out(p, `Événement #${e.seq} émis (${e.kind}, session ${e.session}) dans ${mainRoot(root)}/.ceng/relay/. La coordination le reçoit tout de suite si elle écoute (ceng relay watch).`, e);
      return;
    }
    case 'events': {
      const events = bool(p, 'all') ? relayEvents(root, 0) : pendingRelay(root, reader);
      out(p, events.length ? events.map((e) => line(e, 'human')).join('\n') : 'Aucun événement en attente.', events);
      return;
    }
    case 'ack': {
      const events = relayEvents(root, 0);
      const upto = str(p, 'upto') ? Number(str(p, 'upto')) : (events.at(-1)?.seq ?? 0);
      if (!Number.isFinite(upto)) throw new UsageError('--upto doit être un numéro d\'événement.');
      ackRelay(root, reader, upto);
      out(p, `Événements jusqu'à #${upto} marqués comme traités (lecteur « ${reader} »).`, { reader, upto });
      return;
    }
    case 'watch': {
      const interval = Math.max(1, Number(str(p, 'interval') ?? '5')) * 1000;
      const mode = bool(p, 'human') ? 'human' : 'json';
      await watchRelay(root, { reader, intervalMs: interval, replay: bool(p, 'replay'), onEvent: (e) => process.stdout.write(`${line(e, mode)}\n`) });
      return;
    }
    default:
      throw new UsageError(`Usage : ceng relay emit --kind ${KIND_LIST} --session <nom> [--ref <fichier>] [--note "…"] | watch [--interval 5] [--replay] [--human] | events [--all] | ack [--upto N]   (--dir <projet>, --reader <nom>)`);
  }
}
