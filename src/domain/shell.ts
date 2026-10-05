/**
 * Analyse légère d'une ligne de commande shell (bash ou PowerShell) pour les garde-fous.
 *
 * Objectif : les règles de risque s'appliquent aux commandes EXÉCUTÉES, pas aux données qu'on leur passe
 * (message de commit, `--evidence "…"`, corps de heredoc, commentaire). On « masque » donc le contenu des chaînes
 * entre guillemets, des heredocs et des commentaires, en conservant les substitutions de commande (`$(…)`, `` `…` ``)
 * qui, elles, s'exécutent.
 *
 * Exception volontaire : quand une chaîne EST du code (`bash -c "…"`, `psql -c "…"`, `node -e "…"`, `ssh hôte "…"`,
 * pipeline vers un interpréteur), la commande est dite « porteuse de code » et reste analysée telle quelle.
 * En cas de doute (guillemet non fermé), repli prudent : texte brut, comme avant.
 */

export type ShellKind = 'bash' | 'powershell';

/** Remplace, dans le texte « vivant », les caractères qui ne sont que des données. */
const MASK = '\u0001';

export interface Statement {
  /** Texte d'origine de l'instruction. */
  plain: string;
  /** Même texte, données masquées (même longueur que `plain`). */
  live: string;
  /** Une chaîne de l'instruction est du code (interpréteur, client SQL…) : `live` = `plain`. */
  carriesCode: boolean;
  /** Instruction issue d'une substitution de commande imbriquée. */
  nested: boolean;
}

export interface ParsedCommand {
  statements: Statement[];
  /** Tout le texte, données masquées (ou texte brut si une instruction porte du code ou si l'analyse a échoué). */
  wholeLive: string;
}

const MAX_NESTING = 4;

// ---------------------------------------------------------------- Masquage des données

/** Renvoie le texte avec les données masquées (même longueur), ou null si un guillemet n'est pas fermé. */
export function maskData(src: string, shell: ShellKind = 'bash'): string | null {
  const n = src.length;
  const out = src.split('');
  const esc = shell === 'powershell' ? '`' : '\\';
  let i = 0;
  let balanced = true;

  const mask = (from: number, to: number): void => {
    for (let k = from; k < to; k++) out[k] = MASK;
  };

  /** Texte jusqu'à `stop` (`)` ou `` ` ``) ou la fin ; `null` = code de premier niveau. */
  const scanCode = (stop: ')' | '`' | null): void => {
    let parens = 0;
    const pendingHeredocs: { word: string; indented: boolean }[] = [];
    while (i < n && balanced) {
      const c = src[i]!;
      if (c === esc && i + 1 < n) {
        if (src[i + 1] === '\n') out[i + 1] = ' ';
        else if (';&|"\'$()<>`#'.includes(src[i + 1]!)) out[i + 1] = MASK;
        i += 2;
      } else if (c === "'") {
        scanSingle();
      } else if (c === '"') {
        i++;
        scanDouble();
      } else if (c === '#' && (i === 0 || /[\s;|&(]/.test(src[i - 1]!))) {
        const end = src.indexOf('\n', i);
        const to = end < 0 ? n : end;
        mask(i, to);
        i = to;
      } else if (shell === 'bash' && c === '<' && src[i + 1] === '<' && src[i + 2] !== '<') {
        const m = /^<<(-?)\s*(?:'([^']+)'|"([^"]+)"|\\?([A-Za-z0-9_]+))/.exec(src.slice(i));
        if (m) {
          pendingHeredocs.push({ word: m[2] ?? m[3] ?? m[4]!, indented: m[1] === '-' });
          i += m[0].length;
        } else i += 2;
      } else if (c === '\n' && pendingHeredocs.length) {
        i++;
        for (const doc of pendingHeredocs) consumeHeredoc(doc);
        pendingHeredocs.length = 0;
      } else if (stop === ')' && c === '(') {
        parens++;
        i++;
      } else if (stop === ')' && c === ')') {
        i++;
        if (parens === 0) return;
        parens--;
      } else if (shell === 'bash' && c === '`') {
        i++;
        if (stop === '`') return;
        scanCode('`');
      } else i++;
    }
  };

  const scanSingle = (): void => {
    const start = i + 1;
    let j = start;
    for (;;) {
      if (j >= n) {
        balanced = false;
        return;
      }
      if (src[j] === "'") {
        if (shell === 'powershell' && src[j + 1] === "'") {
          j += 2;
          continue;
        }
        break;
      }
      j++;
    }
    mask(start, j);
    i = j + 1;
  };

  const scanDouble = (): void => {
    while (i < n) {
      const c = src[i]!;
      if (c === esc && i + 1 < n) {
        mask(i, i + 2);
        i += 2;
      } else if (shell === 'powershell' && c === '"' && src[i + 1] === '"') {
        mask(i, i + 2);
        i += 2;
      } else if (c === '"') {
        i++;
        return;
      } else if (c === '$' && src[i + 1] === '(') {
        i += 2;
        scanCode(')');
      } else if (shell === 'bash' && c === '`') {
        i++;
        scanCode('`');
      } else {
        out[i] = MASK;
        i++;
      }
    }
    balanced = false;
  };

  const consumeHeredoc = (doc: { word: string; indented: boolean }): void => {
    const start = i;
    while (i < n) {
      const end = src.indexOf('\n', i);
      const lineEnd = end < 0 ? n : end;
      const line = src.slice(i, lineEnd).replace(/\r$/, '');
      const isEnd = (doc.indented ? line.replace(/^\t+/, '') : line) === doc.word;
      i = end < 0 ? n : end + 1;
      if (isEnd) {
        mask(start, lineEnd);
        return;
      }
    }
    balanced = false;
  };

  scanCode(null);
  return balanced ? out.join('') : null;
}

// ---------------------------------------------------------------- Découpage

interface Cut {
  start: number;
  end: number;
}

/** Découpe aux séparateurs de premier niveau (hors substitutions de commande). `pipes` : coupe aussi sur `|`. */
function splitTopLevel(code: string, shell: ShellKind, pipes: boolean): Cut[] {
  const cuts: Cut[] = [];
  let depth = 0;
  let inTick = false;
  let start = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i]!;
    const next = code[i + 1];
    if (c === '$' && next === '(') {
      depth++;
      i++;
    } else if (c === ')' && depth > 0) depth--;
    else if (shell === 'bash' && c === '`') inTick = !inTick;
    else if (depth === 0 && !inTick) {
      const isDouble = (c === '&' && next === '&') || (c === '|' && next === '|');
      if (c === '\n' || c === ';' || isDouble || (pipes && c === '|')) {
        cuts.push({ start, end: i });
        start = i + (isDouble ? 2 : 1);
        if (isDouble) i++;
      }
    }
  }
  cuts.push({ start, end: code.length });
  return cuts;
}

/** Plages (début, fin) des substitutions de commande de premier niveau d'un texte masqué. */
function substitutionRanges(code: string, shell: ShellKind): Cut[] {
  const ranges: Cut[] = [];
  let depth = 0;
  let from = -1;
  let tickFrom = -1;
  for (let i = 0; i < code.length; i++) {
    const c = code[i]!;
    if (c === '$' && code[i + 1] === '(') {
      if (depth === 0) from = i + 2;
      depth++;
      i++;
    } else if (c === ')' && depth > 0) {
      depth--;
      if (depth === 0) ranges.push({ start: from, end: i });
    } else if (shell === 'bash' && c === '`' && depth === 0) {
      if (tickFrom < 0) tickFrom = i + 1;
      else {
        ranges.push({ start: tickFrom, end: i });
        tickFrom = -1;
      }
    }
  }
  return ranges;
}

/** Ancien découpage, aveugle aux guillemets : repli prudent et traitement des instructions porteuses de code. */
export function naiveSplit(command: string): string[] {
  return command.split(/&&|\|\||;|\n/).map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------- Mots (arguments)

export interface WordOptions {
  /** Ignore les redirections (`> fichier`, `2>&1`) : leurs cibles ne sont pas des arguments de la commande. */
  dropRedirects?: boolean;
}

/** Découpe en mots en respectant les guillemets (un argument entre guillemets reste UN mot, guillemets retirés). */
export function shellWords(segment: string, opts: WordOptions = {}): string[] {
  const words: string[] = [];
  let cur = '';
  let has = false;
  let quote: '"' | "'" | null = null;
  let skipNextWord = false;
  const push = (): void => {
    if (has) {
      if (skipNextWord) skipNextWord = false;
      else words.push(cur);
    }
    cur = '';
    has = false;
  };
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!;
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (/\s/.test(c)) {
      push();
    } else if (c === '<' || c === '>') {
      if (/^\d+$/.test(cur)) {
        cur = '';
        has = false;
      } else push();
      while (segment[i + 1] === c) i++;
      if (segment[i + 1] === '&') {
        // duplication de descripteur (`2>&1`) : pas de fichier cible
        i++;
        while (/[\d-]/.test(segment[i + 1] ?? '')) i++;
      } else if (opts.dropRedirects) skipNextWord = true;
    } else {
      cur += c;
      has = true;
    }
  }
  push();
  return words;
}

// ---------------------------------------------------------------- Programmes

const WRAPPERS = new Set(['npx', 'pnpx', 'bunx', 'sudo', 'doas', 'env', 'nohup', 'time', 'nice', 'command', 'exec']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

export function baseName(token: string): string {
  return (token.split(/[\\/]/).pop() ?? token).replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
}

/** Programme d'une instruction : premier mot hors affectations `VAR=x` (et hors `npx`/`pnpm dlx` qui lancent un autre outil). */
export function programOf(words: readonly string[]): { name: string; rest: string[] } {
  let i = 0;
  while (i < words.length && ASSIGNMENT.test(words[i]!)) i++;
  let name = baseName(words[i] ?? '');
  i++;
  if (['npx', 'pnpx', 'bunx'].includes(name)) {
    while (i < words.length && words[i]!.startsWith('-')) i++;
    name = baseName(words[i] ?? '');
    i++;
  } else if (['pnpm', 'yarn', 'npm'].includes(name) && ['dlx', 'exec'].includes(words[i] ?? '')) {
    i++;
    while (i < words.length && words[i]!.startsWith('-')) i++;
    name = baseName(words[i] ?? '');
    i++;
  }
  return { name, rest: words.slice(i) };
}

/** CLI du framework lui-même (`node .ceng/runtime/cli.js …`, `ceng …`) : ses arguments sont des données. */
export function isCengCli(words: readonly string[]): boolean {
  const { name, rest } = programOf(words);
  if (name === 'ceng' || name === 'claude-eng-framework') return true;
  if (name !== 'node' && name !== 'nodejs') return false;
  const script = rest.find((w) => !w.startsWith('-'));
  return Boolean(script && /(^|[\\/])\.ceng[\\/]runtime[\\/]cli\.js$/.test(script));
}

const SHELLS = /^(?:ba|z|da|k|c|tc|fi)?sh$|^(?:cmd|powershell|pwsh|wsl)$/;
/** Interpréteurs, enveloppes et clients SQL : une chaîne en argument y est du code. */
const CODE_RUNNERS = new Set([
  'eval', 'source', '.', 'sudo', 'su', 'doas', 'env', 'nohup', 'time', 'timeout', 'nice', 'xargs', 'watch', 'ssh', 'runas', 'command', 'builtin', 'call', 'start', 'start-process',
  'invoke-expression', 'iex', 'invoke-command', 'icm',
  'psql', 'pgcli', 'mysql', 'mycli', 'mariadb', 'sqlite3', 'litecli', 'sqlcmd', 'sqlplus', 'usql', 'duckdb', 'clickhouse-client', 'cockroach', 'turso', 'mongosh', 'mongo', 'redis-cli',
  'supabase', 'prisma', 'wrangler',
]);
const SCRIPTERS = new Set(['node', 'nodejs', 'python', 'python3', 'py', 'ruby', 'perl', 'php', 'deno', 'bun', 'lua', 'rscript']);
const CODE_FLAGS = /^-(?:c|e|p|r|command|encodedcommand|ec)$|^--(?:eval|print|command)$/i;
const CONTAINERS = new Set(['docker', 'podman', 'nerdctl', 'kubectl']);

/** Une chaîne de cette instruction (ou d'un maillon du pipeline) est-elle exécutée comme du code ? */
export function carriesCode(words: readonly string[]): boolean {
  const { name, rest } = programOf(words);
  if (SHELLS.test(name) || CODE_RUNNERS.has(name) || WRAPPERS.has(name)) return true;
  if (SCRIPTERS.has(name) && (rest.some((w) => CODE_FLAGS.test(w)) || rest[0] === 'eval')) return true;
  if (CONTAINERS.has(name) && rest.some((w) => w === 'exec' || w === 'run')) return true;
  return words.some((w) => w === '-exec' || w === '-execdir' || w === '-ok');
}

// ---------------------------------------------------------------- Analyse

function conservative(command: string): ParsedCommand {
  return {
    statements: naiveSplit(command).map((s) => ({ plain: s, live: s, carriesCode: true, nested: false })),
    wholeLive: command,
  };
}

/** Découpe une commande en instructions analysables (substitutions imbriquées incluses, marquées `nested`). */
export function parseCommand(command: string, shell: ShellKind = 'bash', depth = 0): ParsedCommand {
  const masked = maskData(command, shell);
  if (masked === null) return conservative(command);
  const statements: Statement[] = [];
  let anyCode = false;
  for (const cut of splitTopLevel(masked, shell, false)) {
    const plain = command.slice(cut.start, cut.end).trim();
    if (!plain) continue;
    const live = masked.slice(cut.start, cut.end);
    const liveTrim = live.trim();
    if (plain.length !== live.trim().length) {
      // alignement texte/masque perdu (cas limite) : analyse prudente du texte brut
      anyCode = true;
      for (const s of naiveSplit(plain)) statements.push({ plain: s, live: s, carriesCode: true, nested: depth > 0 });
      continue;
    }
    const pipeline = splitTopLevel(liveTrim, shell, true).map((c) => shellWords(liveTrim.slice(c.start, c.end)));
    if (pipeline.some(carriesCode)) {
      anyCode = true;
      for (const s of naiveSplit(plain)) statements.push({ plain: s, live: s, carriesCode: true, nested: depth > 0 });
      continue;
    }
    statements.push({ plain, live: liveTrim, carriesCode: false, nested: depth > 0 });
    if (depth >= MAX_NESTING) continue;
    for (const range of substitutionRanges(live, shell)) {
      const inner = command.slice(cut.start + range.start, cut.start + range.end);
      if (inner.trim()) statements.push(...parseCommand(inner, shell, depth + 1).statements.map((s) => ({ ...s, nested: true })));
    }
  }
  return { statements, wholeLive: anyCode ? command : masked };
}

/** Instructions de premier niveau, texte d'origine (guillemets respectés : `;` ou `&&` dans une chaîne ne coupent pas). */
export function splitCommand(command: string, shell: ShellKind = 'bash'): string[] {
  return parseCommand(command, shell).statements.filter((s) => !s.nested).map((s) => s.plain);
}

/** Maillons d'un pipeline (`a | b`), à partir d'une instruction (live et plain restent alignés). */
export function splitPipes(statement: Statement, shell: ShellKind = 'bash'): Statement[] {
  if (statement.carriesCode) return statement.plain.split('|').map((s) => s.trim()).filter(Boolean).map((s) => ({ ...statement, plain: s, live: s }));
  return splitTopLevel(statement.live, shell, true)
    .map((c) => ({ ...statement, plain: statement.plain.slice(c.start, c.end).trim(), live: statement.live.slice(c.start, c.end).trim() }))
    .filter((s) => s.plain);
}
