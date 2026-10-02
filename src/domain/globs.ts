/**
 * Glob minimal et sans dépendance : `**`, `*`, `?`, `{a,b}`.
 * Sert à la propriété de fichiers entre tâches parallèles et aux règles de garde.
 */

const GLOB_CHARS = /[*?{[]/;

export function normalizePath(p: string): string {
  let out = p.replace(/\\/g, '/');
  while (out.startsWith('./')) out = out.slice(2);
  return out.replace(/\/+/g, '/');
}

export function isLiteral(glob: string): boolean {
  return !GLOB_CHARS.test(glob);
}

export function globToRegExp(glob: string): RegExp {
  const g = normalizePath(glob);
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    if (c === '*') {
      if (g[i + 1] === '*') {
        // `**/` = zéro ou plusieurs répertoires ; `**` final = tout
        if (g[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const end = g.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
      } else {
        const alts = g.slice(i + 1, end).split(',').map(escapeRegExp);
        re += `(?:${alts.join('|')})`;
        i = end;
      }
    } else {
      re += escapeRegExp(c);
    }
  }
  return new RegExp(`^${re}$`);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(normalizePath(path));
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => matchesGlob(path, g));
}

/** Préfixe statique d'un glob, jusqu'au dernier `/` avant le premier caractère joker. */
function staticPrefix(glob: string): string {
  const g = normalizePath(glob);
  const idx = g.search(GLOB_CHARS);
  if (idx === -1) return g;
  const slash = g.lastIndexOf('/', idx);
  return slash === -1 ? '' : g.slice(0, slash + 1);
}

/**
 * Deux globs peuvent-ils désigner un même fichier ?
 * Exact quand au moins un côté est littéral ; conservateur (préfixes) sinon :
 * un faux positif ne coûte qu'un parallélisme manqué, un faux négatif coûterait un conflit.
 */
export function globsOverlap(a: string, b: string): boolean {
  const na = normalizePath(a);
  const nb = normalizePath(b);
  if (isLiteral(na) && isLiteral(nb)) return na === nb;
  if (isLiteral(na)) return globToRegExp(nb).test(na);
  if (isLiteral(nb)) return globToRegExp(na).test(nb);
  const pa = staticPrefix(na);
  const pb = staticPrefix(nb);
  return pa.startsWith(pb) || pb.startsWith(pa);
}

export function fileSetsOverlap(a: readonly string[], b: readonly string[]): boolean {
  return a.some((x) => b.some((y) => globsOverlap(x, y)));
}
