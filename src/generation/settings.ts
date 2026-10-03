import type { Autonomy, Parallelism } from '../domain/types.js';

/**
 * Génération et fusion NON destructive de `.claude/settings.json`.
 * On ajoute ce qui manque (règles, hooks) ; on ne supprime ni ne remplace jamais une valeur de l'utilisateur.
 */

export const HOOK_RUNNER = 'node "${CLAUDE_PROJECT_DIR}/.ceng/runtime/hooks/run.js"';

export interface HookHandler {
  type: 'command';
  command: string;
  timeout?: number;
  async?: boolean;
  statusMessage?: string;
}

export interface HookGroup {
  matcher?: string;
  hooks: HookHandler[];
}

export interface ClaudeSettings {
  permissions?: { allow?: string[]; ask?: string[]; deny?: string[]; [k: string]: unknown };
  hooks?: Record<string, HookGroup[]>;
  env?: Record<string, string>;
  [k: string]: unknown;
}

const hook = (event: string, extra: Partial<HookHandler> = {}): HookHandler => ({ type: 'command', command: `${HOOK_RUNNER} ${event}`, timeout: 30, ...extra });

export function frameworkHooks(): Record<string, HookGroup[]> {
  return {
    SessionStart: [{ matcher: 'startup|resume|clear|compact', hooks: [hook('session-start'), hook('graph-refresh', { async: true, timeout: 15 })] }],
    PreToolUse: [
      { matcher: 'Bash|PowerShell', hooks: [hook('guard-command')] },
      { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [hook('guard-file')] },
      { matcher: 'Agent|Task', hooks: [hook('agent-spawn', { timeout: 10 })] },
      { matcher: 'AskUserQuestion', hooks: [hook('ask-question', { timeout: 10 })] },
    ],
    PostToolUse: [
      { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [hook('file-edited', { async: true, timeout: 10 })] },
      { matcher: 'Skill', hooks: [hook('skill-used', { timeout: 10 })] },
      { matcher: 'AskUserQuestion', hooks: [hook('question-answered', { async: true, timeout: 10 })] },
    ],
    SubagentStart: [{ hooks: [hook('subagent-start', { timeout: 10 })] }],
    SubagentStop: [{ hooks: [hook('subagent-stop'), hook('graph-refresh', { async: true, timeout: 15 })] }],
    PreCompact: [{ hooks: [hook('pre-compact', { timeout: 60 })] }],
    Stop: [{ hooks: [hook('stop'), hook('graph-refresh', { async: true, timeout: 15 })] }],
    StopFailure: [{ hooks: [hook('stop-failure', { timeout: 10 })] }],
    UserPromptSubmit: [{ hooks: [hook('user-prompt', { timeout: 10 })] }],
    PermissionRequest: [{ hooks: [hook('permission-request', { timeout: 10 })] }],
    TaskCompleted: [{ hooks: [hook('task-completed')] }],
    SessionEnd: [{ hooks: [hook('session-end', { timeout: 5 })] }],
  };
}

/** Règles natives Claude Code (évaluées deny → ask → allow) : première ligne de défense pour les secrets. */
export function frameworkPermissions(autonomy: Autonomy): Required<Pick<NonNullable<ClaudeSettings['permissions']>, 'allow' | 'ask' | 'deny'>> {
  const deny = [
    'Read(./.env)', 'Read(./.env.local)', 'Read(./.env.*.local)', 'Read(./.env.production)', 'Read(./.env.development)', 'Read(./.env.staging)', 'Read(./.env.test)',
    'Read(./**/.env)', 'Read(./**/*.pem)', 'Read(./**/*.key)', 'Read(./**/id_rsa*)', 'Read(./**/id_ed25519*)', 'Read(./**/credentials.json)', 'Read(./**/service-account*.json)',
    'Edit(./.env)', 'Edit(./**/.env)', 'Edit(./.git/**)',
    'Bash(rm -rf /*)', 'Bash(rm -rf ~*)',
  ];
  const ask = [
    'Bash(git push --force *)', 'Bash(git push -f *)', 'Bash(git reset --hard *)', 'Bash(git clean *)', 'Bash(npm publish *)', 'Bash(terraform apply *)', 'Bash(terraform destroy *)',
    'Bash(kubectl delete *)', 'Bash(kubectl apply *)', 'Edit(./.claude/settings.json)', 'Edit(./.ceng/config.json)',
  ];
  const allow = [
    'Bash(node .ceng/runtime/cli.js *)', 'Bash(git status *)', 'Bash(git diff *)', 'Bash(git log *)',
    'Read(./.ceng/**)', 'Edit(./.ceng/brain/**)',
    // Requêtes en lecture seule sur un graphe de code existant (graphify), sans coût LLM.
    'Bash(graphify query *)', 'Bash(graphify path *)', 'Bash(graphify explain *)', 'Bash(graphify affected *)', 'Bash(graphify god-nodes *)',
  ];
  if (autonomy !== 'supervised') allow.push('Bash(git add *)', 'Bash(git commit *)', 'Bash(git checkout -b *)', 'Bash(git switch -c *)');
  return { allow, ask, deny };
}

function union(a: readonly string[] = [], b: readonly string[] = []): string[] {
  return [...new Set([...a, ...b])];
}

const isFrameworkHandler = (h: HookHandler) => h.command.includes('.ceng/runtime/hooks/run.js');

export interface MergeOptions {
  autonomy: Autonomy;
  parallelism: Parallelism;
}

export function mergeSettings(existing: ClaudeSettings | undefined, opts: MergeOptions): ClaudeSettings {
  const base: ClaudeSettings = structuredClone(existing ?? {});
  const perms = frameworkPermissions(opts.autonomy);
  base.permissions = {
    ...(base.permissions ?? {}),
    allow: union(base.permissions?.allow, perms.allow),
    ask: union(base.permissions?.ask, perms.ask),
    deny: union(base.permissions?.deny, perms.deny),
  };
  // Les hooks du framework sont remplacés à chaque init/upgrade ; ceux de l'utilisateur sont conservés tels quels.
  const hooks: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(base.hooks ?? {})) {
    const kept = groups
      .map((g) => ({ ...g, hooks: g.hooks.filter((h) => !isFrameworkHandler(h)) }))
      .filter((g) => g.hooks.length > 0);
    if (kept.length) hooks[event] = kept;
  }
  for (const [event, groups] of Object.entries(frameworkHooks())) hooks[event] = [...(hooks[event] ?? []), ...groups];
  base.hooks = hooks;
  if (opts.parallelism === 'teams') base.env = { ...(base.env ?? {}), CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: base.env?.['CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'] ?? '1' };
  return base;
}

/** Retire proprement tout ce que le framework a ajouté (pour `ceng uninstall`). */
export function stripFramework(existing: ClaudeSettings): ClaudeSettings {
  const base = structuredClone(existing);
  const hooks: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(base.hooks ?? {})) {
    const kept = groups.map((g) => ({ ...g, hooks: g.hooks.filter((h) => !isFrameworkHandler(h)) })).filter((g) => g.hooks.length > 0);
    if (kept.length) hooks[event] = kept;
  }
  if (Object.keys(hooks).length) base.hooks = hooks;
  else delete base.hooks;
  const perms = frameworkPermissions('high');
  const supervised = frameworkPermissions('supervised');
  if (base.permissions) {
    const drop = (list: string[] | undefined, ours: string[]) => list?.filter((r) => !ours.includes(r));
    base.permissions.allow = drop(base.permissions.allow, union(perms.allow, supervised.allow));
    base.permissions.ask = drop(base.permissions.ask, perms.ask);
    base.permissions.deny = drop(base.permissions.deny, perms.deny);
  }
  return base;
}
