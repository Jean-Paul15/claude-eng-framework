import { matchesAny } from './globs.js';

/**
 * Mode « équipe autonome » : plusieurs sessions travaillent en parallèle sans humain devant l'écran. Le framework tranche à sa place
 * les demandes de permission, selon une liste de sécurité fermée :
 *  - ALLOW  : lecture, recherche, coordination entre sessions, outils locaux : autorisé tout de suite, sans boîte de permission ;
 *  - DEFER  : effet hors de la machine ou irréversible (base de production, déploiement, e-mail, paiement, secrets, changement de
 *             mode de permission) : refusé proprement et consigné pour l'humain, sans jamais attendre ;
 *  - DENY   : interdit quoi que dise l'humain (désactiver les garde-fous).
 * Ce n'est PAS un contournement des permissions : c'est leur remplacement par des règles explicites et journalisées. Les secrets, les
 * dépenses et la publication publique restent à l'humain.
 */

export type TeamDecision = 'allow' | 'defer' | 'deny';

export interface TeamVerdict {
  decision: TeamDecision;
  reason: string;
}

/** Outils natifs de Claude Code sans effet extérieur : autorisés (les écritures de fichiers passent déjà par le garde de fichiers). */
const NATIVE_ALLOW = new Set([
  'Read', 'Glob', 'Grep', 'LS', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'NotebookRead', 'TodoWrite', 'Task', 'Agent',
  'Skill', 'ToolSearch', 'Monitor', 'TaskStop', 'TaskOutput', 'WebSearch', 'WebFetch', 'ExitPlanMode', 'EnterPlanMode',
  'CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup', 'SendUserFile', 'PushNotification', 'ReadNotifications',
  'ListAgents', 'SendMessage', 'AskUserQuestion',
]);

/** Verbes d'un nom d'outil MCP qui ne font que lire. */
const READ_ONLY_TOOL = /^(get|list|read|search|query|find|describe|inspect|view|show|fetch|check|status|tables|logs|insights|functionSpec|data|envGet|envList|whoami|take_snapshot|take_screenshot|screenshot|navigate|read_page|get_page_text|resize_window|tabs_[a-z_]+|preview_[a-z_]+|zoom|hover|scroll|wait|wait_for|list_[a-z_]+|get_[a-z_]+|search_[a-z_]+|read_[a-z_]+)$/i;

/** Serveurs MCP entièrement locaux ou de coordination : autorisés sauf liste d'exceptions ci-dessous. */
const LOCAL_SERVERS = ['ccd_session_mgmt', 'ccd_session', 'ccd_view', 'ccd_window', 'ccd_sidebar', 'Claude_Browser', 'plugin_playwright_playwright', 'chrome-devtools', 'terminal', 'visualize'];

/** Outils de ces serveurs qui restent à l'humain (jamais d'auto-élévation, pas de suppression de session). */
const LOCAL_SERVER_DEFER = /^(set_session_permission_mode|delete_session|archive_session|clear_session|set_remote_control|move_to_cloud|set_session_fast_mode)$/;

/** Serveurs MCP dont chaque écriture a un effet extérieur : refusés sauf lecture (la liste n'est qu'un rappel, la règle générale suffit). */
const EXTERNAL_HINT = /(supabase|convex|vercel|gmail|google|calendar|drive|figma|notion|slack|linear|asana|atlassian|intercom|claude-in-chrome|chariow|scheduled-tasks|mcp-registry|e151d37d|29d2a6b5|8e6f88c0|a076e1fd|2d76c720|dc3de9bc)/i;

export function splitMcpName(toolName: string): { server: string; tool: string } | undefined {
  const m = /^mcp__(.+?)__(.+)$/.exec(toolName);
  return m ? { server: m[1]!, tool: m[2]! } : undefined;
}

export interface TeamOptions {
  /** Motifs d'outils MCP (« mcp__serveur__outil », `*` accepté) que l'humain autorise explicitement. */
  mcpAllow?: readonly string[];
  /** Motifs d'outils MCP toujours refusés, même s'ils ressemblent à une lecture. */
  mcpDefer?: readonly string[];
}

/** Classe un outil qui n'est pas une commande shell. Les commandes shell passent par `classifyCommand` (guardrails). */
export function classifyTeamTool(toolName: string, options: TeamOptions = {}): TeamVerdict {
  if (NATIVE_ALLOW.has(toolName)) return { decision: 'allow', reason: `outil natif sans effet extérieur (${toolName})` };
  const mcp = splitMcpName(toolName);
  if (!mcp) return { decision: 'defer', reason: `outil inconnu du mode équipe (${toolName}) : validation humaine` };
  if (options.mcpDefer && matchesAny(toolName, [...options.mcpDefer])) return { decision: 'defer', reason: `outil MCP refusé par la configuration (${toolName})` };
  if (options.mcpAllow && matchesAny(toolName, [...options.mcpAllow])) return { decision: 'allow', reason: `outil MCP autorisé par la configuration (${toolName})` };
  if (LOCAL_SERVERS.includes(mcp.server)) {
    return LOCAL_SERVER_DEFER.test(mcp.tool)
      ? { decision: 'defer', reason: `${mcp.tool} : changement de permission ou de session, décision humaine` }
      : { decision: 'allow', reason: `serveur local ou de coordination (${mcp.server})` };
  }
  if (READ_ONLY_TOOL.test(mcp.tool) && !EXTERNAL_HINT.test(mcp.server)) {
    return { decision: 'allow', reason: `lecture seule (${mcp.tool})` };
  }
  if (READ_ONLY_TOOL.test(mcp.tool)) {
    // Un serveur externe : une lecture simple reste permise ; ce qui ressemble à un envoi ou à une écriture ne passe jamais ici.
    return /^(get|list|read|search|query|find|describe|view|show|check|status|tables|logs|insights|whoami|envGet|envList)/i.test(mcp.tool)
      ? { decision: 'allow', reason: `lecture seule sur un service externe (${mcp.server}.${mcp.tool})` }
      : { decision: 'defer', reason: `${mcp.server}.${mcp.tool} : action sur un service externe, validation humaine` };
  }
  return { decision: 'defer', reason: `${mcp.server}.${mcp.tool} : effet possible hors de la machine (base, déploiement, e-mail, paiement, secret) : validation humaine` };
}
