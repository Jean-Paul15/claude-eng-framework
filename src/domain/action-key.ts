import { approvalTriggers } from './guardrails.js';
import { parseCommand, programOf, shellWords, splitPipes, type ShellKind, type Statement } from './shell.js';

/**
 * Identité d'une ACTION à valider, indépendante de la façon dont la commande est écrite.
 *
 * Une même action (`supabase db push --include-all`) est demandée sous plusieurs formes selon ce qui l'entoure :
 * `… 2>&1`, `… | tail -3`, `cd app && …`, avant ou après une autre commande. Ces habillages n'en changent ni l'effet
 * ni le risque : la clé les ignore, pour que l'humain ne valide pas deux fois la même chose.
 *
 *  - commande qui déclenche une règle d'approbation : la clé est faite des SEULES sous-commandes à risque (triées),
 *    donc `a && b` et `b ; a` ont la même clé, mais ajouter une seconde sous-commande à risque la change ;
 *  - autre commande : la commande entière, débarrassée de l'habillage.
 */

/** Filtres d'affichage en fin de pipeline : ils ne changent pas ce qui est exécuté en amont. */
const DISPLAY_FILTERS = new Set(['tail', 'head', 'grep', 'egrep', 'fgrep', 'rg', 'wc', 'less', 'more', 'cat', 'findstr', 'select-object', 'select-string', 'out-null', 'out-host', 'out-string']);
const DIR_CHANGES = new Set(['cd', 'chdir', 'pushd', 'popd', 'set-location', 'sl']);
/** Opérateur de redirection au début d'un mot : `>f`, `2>&1`, `&>f`, `>>f`, `<f` (jamais `<<` : heredoc, qui porte des données). */
const REDIRECTION = /^(?:\d*|&)(?:>>?\|?|<)(&\d*-?)?/;

/** Découpe aux espaces hors guillemets, sans toucher au texte des mots (guillemets conservés). */
function rawWords(text: string): string[] {
  const words: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\\' && quote !== "'" && i + 1 < text.length) {
      cur += c + text[++i]!;
    } else if (quote) {
      cur += c;
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (/\s/.test(c)) {
      if (cur) words.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur) words.push(cur);
  return words;
}

/** Une instruction simple sans ses redirections (`2>&1`, `> log`, `2>/dev/null`) ni ses espaces superflus. */
export function normalizeUnit(text: string): string {
  const words = rawWords(text);
  const kept: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const m = w.startsWith('<<') ? null : REDIRECTION.exec(w);
    if (!m) kept.push(w);
    else if (m[1] === undefined && m[0].length === w.length) i++; // opérateur seul : sa cible est le mot suivant
  }
  return kept.join(' ');
}

const isDisplayFilter = (unit: string): boolean => DISPLAY_FILTERS.has(programOf(shellWords(unit)).name);
const isDirChange = (unit: string): boolean => DIR_CHANGES.has(programOf(shellWords(unit)).name);

/** Instruction (pipeline) sans les filtres d'affichage de fin (`| tail -3`) ni les redirections. */
function normalizeStatement(statement: Statement, shell: ShellKind): string {
  const units = splitPipes(statement, shell).map((u) => normalizeUnit(u.plain)).filter(Boolean);
  while (units.length > 1 && isDisplayFilter(units[units.length - 1]!)) units.pop();
  return units.join(' | ');
}

/** Commande entière sans habillage : sans `cd <dossier> &&`, redirections ni filtres d'affichage ; instructions dans l'ordre. */
export function normalizeCommand(command: string, shell: ShellKind = 'bash'): string {
  const statements = parseCommand(command.trim(), shell).statements.filter((s) => !s.nested);
  const parts = statements.map((s) => normalizeStatement(s, shell)).filter(Boolean);
  const meaningful = parts.filter((p) => !isDirChange(p));
  return (meaningful.length ? meaningful : parts).join(' ; ');
}

/** Matière de la clé d'action d'une commande (voir en-tête). */
export function commandActionMaterial(command: string, shell: ShellKind = 'bash'): string {
  const triggers = approvalTriggers(command, shell);
  if (!triggers.length) return normalizeCommand(command, shell);
  return [...new Set(triggers.map((t) => normalizeUnit(t.text)))].sort().join(' ;; ');
}
