import { matchesAny } from './globs.js';
import { parseTables } from './data-map.js';
/**
 * Contrôle immédiat du code qui vient d'être écrit (hook PostToolUse) : mauvais motifs connus, fichiers et lignes trop
 * longs, imbrication profonde. Pur et rapide (expressions régulières, aucune analyse lourde) : il ne remplace pas le lint
 * du projet, il prévient l'agent tout de suite, pendant qu'il a encore le code en tête.
 * On n'analyse que le texte NOUVEAU (pas le legacy du fichier) : pas de bruit sur ce que l'agent n'a pas touché.
 */

export type Severity = 'warn' | 'block';

export interface Finding {
  rule: string;
  severity: Severity;
  message: string;
  /** Ligne dans le texte nouveau (1 = première ligne écrite). */
  line?: number;
}

export interface CodeCheckLimits {
  maxFileLines: number;
  maxLineLength: number;
  maxIndentLevels: number;
}

export const DEFAULT_LIMITS: CodeCheckLimits = { maxFileLines: 500, maxLineLength: 160, maxIndentLevels: 6 };

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|py|rb|go|rs|java|kt|kts|swift|dart|php|cs|sql)$/i;
const SKIP_PATH = /(^|\/)(node_modules|dist|build|out|coverage|vendor|\.dart_tool|\.ceng|graphify-out|__generated__|generated)(\/|$)|\.(min|d|g|freezed)\.[a-z]+$|\.lock$/i;
const TEST_PATH = /(^|\/)(test|tests|__tests__|spec|integration_test|e2e)(\/|$)|[._-](test|spec)\.[a-z]+$|_test\.[a-z]+$/i;

interface PatternRule {
  rule: string;
  severity: Severity;
  pattern: RegExp;
  message: string;
  /** Extensions concernées (toutes si absent). */
  ext?: RegExp;
  /** Ignorée dans les fichiers de test. */
  notInTests?: boolean;
}

const JS = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/i;
const TS = /\.(ts|tsx)$/i;
const PY = /\.py$/i;
const DART = /\.dart$/i;

const RULES: PatternRule[] = [
  // Sécurité : bloquant (l'agent doit corriger avant de continuer).
  { rule: 'hardcoded-secret', severity: 'block', pattern: /\b(sk_live_[0-9a-zA-Z]{10,}|sb_secret_[0-9a-zA-Z_-]{10,}|AKIA[0-9A-Z]{16}|ghp_[0-9A-Za-z]{30,}|xox[bp]-[0-9A-Za-z-]{10,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----)/, message: 'secret en dur dans le code : le lire depuis l\'environnement' },
  { rule: 'eval', severity: 'block', pattern: /(^|[^.\w])(eval|new\s+Function)\s*\(/, message: 'exécution de code dynamique (eval/new Function)', ext: JS },
  { rule: 'sql-injection', severity: 'block', pattern: /\b(select|insert|update|delete)\b[^;\n]{0,80}\b(from|into|set|where)\b[^;\n]*(\$\{|"\s*\+\s*\w|'\s*\+\s*\w|%s|\bf["'])/i, message: 'requête SQL construite par concaténation ou interpolation : requête paramétrée' },
  { rule: 'html-injection', severity: 'warn', pattern: /dangerouslySetInnerHTML|\.innerHTML\s*=|v-html=/, message: 'HTML brut injecté : seulement sur une donnée sûre ou assainie' },
  // Robustesse.
  { rule: 'empty-catch', severity: 'warn', pattern: /catch\s*(\([^)]*\))?\s*\{\s*\}|except(\s+\w+)?\s*:\s*pass\b/, message: 'erreur avalée en silence : la gérer, la journaliser ou la propager (ou dire pourquoi l\'ignorer)' },
  { rule: 'ts-escape', severity: 'warn', pattern: /@ts-ignore|@ts-nocheck|eslint-disable(?!-next-line)/, message: 'désactivation du typage ou du lint', ext: JS },
  { rule: 'any-type', severity: 'warn', pattern: /:\s*any\b|<any>|as\s+any\b/, message: 'type `any` : typer précisément', ext: TS },
  // Restes de mise au point.
  { rule: 'debug-leftover', severity: 'warn', pattern: /\bconsole\.(log|debug)\(|\bdebugger\b/, message: 'trace de mise au point laissée (console.log/debugger)', ext: JS, notInTests: true },
  { rule: 'debug-leftover', severity: 'warn', pattern: /^\s*print\(/, message: 'print laissé : utiliser le logger du projet', ext: /\.(py|dart)$/i, notInTests: true },
  { rule: 'todo-orphan', severity: 'warn', pattern: /\b(TODO|FIXME|HACK|XXX)\b(?![^\n]*\b(T-\d{4}|#\d+|[A-Z]+-\d+))/, message: 'TODO sans tâche : le faire maintenant ou créer la tâche (ceng task add) et la citer' },
  // Performance et données.
  { rule: 'select-star', severity: 'warn', pattern: /\bselect\s+\*\s+from\b/i, message: 'SELECT * : lister les colonnes utiles', notInTests: true },
  { rule: 'query-in-loop', severity: 'warn', pattern: /\b(for|forEach|map|while)\b[^\n]*\{[^\n]*\bawait\b[^\n]*\b(query|find\w*|select|from\(|get\w*ById|fetch)\b/, message: 'requête dans une boucle (N+1 probable) : charger en lot', ext: JS },
  { rule: 'sync-io', severity: 'warn', pattern: /\b(readFileSync|writeFileSync|execSync)\b/, message: 'I/O synchrone : bloque le serveur si c\'est un chemin de requête', ext: /\.(ts|js|mjs|cjs)$/i, notInTests: true },
  { rule: 'bare-except', severity: 'warn', pattern: /^\s*except\s*:/, message: 'except nu : capturer l\'exception attendue', ext: PY },
  { rule: 'context-after-await', severity: 'warn', pattern: /await[^\n]*;\s*\n[^\n]*\b(Navigator\.of|ScaffoldMessenger\.of|Theme\.of)\(context\)/, message: 'BuildContext utilisé après un await : vérifier `context.mounted`', ext: DART },
  { rule: 'insecure-url', severity: 'warn', pattern: /["']http:\/\/(?!localhost|127\.0\.0\.1|10\.0\.2\.2|0\.0\.0\.0)[a-z0-9.-]+/i, message: 'URL en http:// : https', notInTests: true },
];

const INDENT_UNIT = 2;

/** Analyse le texte nouveau d'un fichier (et la taille totale du fichier). Rien pour un fichier qui n'est pas du code. */
export interface CustomRule {
  pattern: string;
  message: string;
  glob?: string;
}

export function checkCode(file: string, newText: string, totalLines: number, limits: CodeCheckLimits = DEFAULT_LIMITS, custom: readonly (CustomRule & { id?: string })[] = []): Finding[] {
  const path = file.replace(/\\/g, '/');
  if (!CODE_EXT.test(path) || SKIP_PATH.test(path)) return [];
  // Migrations : seules celles écrites à la main en SQL sont contrôlées (les autres, générées par un ORM, sont ignorées).
  if (/(^|\/)migrations?\//i.test(path) && !/\.sql$/i.test(path)) return [];
  const isTest = TEST_PATH.test(path);
  const findings: Finding[] = [];
  const lines = newText.split(/\r?\n/);

  for (const r of RULES) {
    if (r.ext && !r.ext.test(path)) continue;
    if (r.notInTests && isTest) continue;
    if (r.pattern.flags.includes('m') || r.rule === 'context-after-await') {
      if (r.pattern.test(newText)) findings.push({ rule: r.rule, severity: r.severity, message: r.message });
      continue;
    }
    const at = lines.findIndex((l) => r.pattern.test(l));
    if (at >= 0) findings.push({ rule: r.rule, severity: r.severity, message: r.message, line: at + 1 });
  }

  const longAt = lines.findIndex((l) => l.length > limits.maxLineLength && !/https?:\/\/|^\s*(import|export .* from|\/\/|#|\*)/.test(l));
  if (longAt >= 0) findings.push({ rule: 'long-line', severity: 'warn', line: longAt + 1, message: `ligne de plus de ${limits.maxLineLength} caractères : la découper (lisibilité)` });

  if (!/\.sql$/i.test(path)) {
    const deepAt = lines.findIndex((l) => {
      const indent = /^( *)/.exec(l.replace(/\t/g, '  '))![1]!.length;
      return l.trim().length > 0 && indent / INDENT_UNIT > limits.maxIndentLevels + (/\.(dart|tsx|jsx|vue|svelte)$/i.test(path) ? 4 : 0);
    });
    if (deepAt >= 0) findings.push({ rule: 'deep-nesting', severity: 'warn', line: deepAt + 1, message: 'imbrication très profonde : extraire une fonction ou un composant, retours anticipés' });
  }

  if (/\.sql$/i.test(path)) findings.push(...checkSql(path, newText));

  // Règles du projet : une leçon apprise (revue, incident) qui ne doit plus pouvoir être réécrite.
  for (const r of custom) {
    if (r.glob && !matchesAny(path, [r.glob])) continue;
    let re: RegExp;
    try {
      re = new RegExp(r.pattern);
    } catch {
      continue;
    }
    const at = lines.findIndex((l) => re.test(l));
    if (at >= 0) findings.push({ rule: `projet${r.id ? `-${r.id}` : ''}`, severity: 'warn', message: r.message, line: at + 1 });
  }

  if (totalLines > limits.maxFileLines && !isTest) {
    findings.push({ rule: 'long-file', severity: 'warn', message: `fichier de ${totalLines} lignes (> ${limits.maxFileLines}) : le scinder par responsabilité (sans reformater tout le fichier dans ce changement)` });
  }
  return findings;
}

/**
 * Migrations SQL écrites à la main : là où une erreur coûte le plus. Avertissements seulement (jamais bloquants) :
 * table sans RLS exposée par l'API (projets Supabase), clé étrangère sans index, destruction sans garde.
 */
function checkSql(file: string, text: string): Finding[] {
  const out: Finding[] = [];
  const tables = parseTables(text).filter((t) => !t.alter);
  if (/(^|\/)supabase\//i.test(file)) {
    const noRls = tables.filter((t) => !new RegExp(`alter\\s+table\\s+(?:only\\s+)?(?:[\\w"]+\\.)?"?${t.name}"?\\s+enable\\s+row\\s+level\\s+security`, 'i').test(text) && /create\s+table/i.test(text));
    if (noRls.length) out.push({ rule: 'rls-missing', severity: 'warn', message: `table ${noRls.map((t) => t.name).join(', ')} sans « enable row level security » : exposée par l'API sans politique d'accès` });
  }
  const unindexed: string[] = [];
  for (const t of tables) {
    for (const def of splitDefs(t.body)) {
      const col = /^\s*"?(\w+)"?\s+[^,]*\breferences\b/i.exec(def)?.[1];
      if (!col || /\b(primary\s+key|unique)\b/i.test(def)) continue;
      if (!new RegExp(`create\\s+(?:unique\\s+)?index[^;]*\\(\\s*"?${col}\\b`, 'i').test(text)) unindexed.push(`${t.name}.${col}`);
    }
  }
  if (unindexed.length) out.push({ rule: 'fk-no-index', severity: 'warn', message: `clé étrangère sans index : ${unindexed.slice(0, 4).join(', ')} (jointures et suppressions en cascade lentes)` });
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l, i) => /^\s*(drop\s+(table|column)|truncate)\b/i.test(l) && !/expand\/contract|irréversible/i.test(`${lines[i - 1] ?? ''} ${l}`));
  if (at >= 0) out.push({ rule: 'destructive-migration', severity: 'warn', line: at + 1, message: 'suppression de table ou de colonne : prévoir expand/contract ou noter « -- irréversible : raison » sur la ligne précédente' });
  return out;
}

function splitDefs(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Message court à renvoyer à l'agent (une ligne par constat). */
export function formatFindings(file: string, findings: readonly Finding[]): string {
  const head = findings.some((f) => f.severity === 'block') ? `[ceng] À corriger avant de continuer dans ${file} :` : `[ceng] Contrôle de ${file} :`;
  return [head, ...findings.map((f) => `- ${f.severity === 'block' ? 'BLOQUANT ' : ''}${f.rule}${f.line ? ` (ligne ${f.line} du texte écrit)` : ''} : ${f.message}`)].join('\n');
}
