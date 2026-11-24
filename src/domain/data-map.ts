/**
 * Carte des données personnelles, générée depuis les migrations SQL : chaque colonne d'une table liée à une personne porte un
 * commentaire normalisé `pii:<catégorie>; purpose:…; basis:…; retention:…`. Analyse approchée (SQL courant : `create table`,
 * `alter table … add column`, `comment on column`) ; une table est « personnelle » d'après des indices (voir `isPersonalTable`).
 */

export const PII_CATEGORIES = ['none', 'identity', 'contact', 'location', 'financial', 'health', 'content', 'technical'] as const;
export const LEGAL_BASES = ['consent', 'contract', 'legal-obligation', 'legitimate-interest', 'vital-interest', 'public-task'] as const;

export interface TableDef {
  name: string;
  columns: string[];
  /** Corps de la déclaration (indices de liaison à une personne). */
  body: string;
}

export interface Classification {
  table: string;
  column: string;
  pii: string;
  purpose?: string;
  basis?: string;
  retention?: string;
}

const CONSTRAINT = /^(primary|foreign|unique|check|constraint|like|exclude)\b/i;
const ident = (s: string): string => s.replace(/^["`]|["`]$/g, '').toLowerCase();
const tableName = (raw: string): string => ident(raw.split('.').pop() ?? raw);

/** Découpe `a, b(1,2), c` aux virgules de premier niveau. */
function splitTop(body: string): string[] {
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

const stripComments = (sql: string): string => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

export function parseTables(sqlRaw: string): TableDef[] {
  const sql = stripComments(sqlRaw);
  const out: TableDef[] = [];
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."`]+)\s*\(/gi)) {
    let depth = 1;
    let i = m.index! + m[0].length;
    const start = i;
    for (; i < sql.length && depth > 0; i++) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') depth--;
    }
    const body = sql.slice(start, i - 1);
    const columns = splitTop(body)
      .map((d) => d.trim())
      .filter((d) => d && !CONSTRAINT.test(d))
      .map((d) => ident(d.split(/\s+/)[0]!));
    out.push({ name: tableName(m[1]!), columns, body });
  }
  for (const m of sql.matchAll(/alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?([\w."`]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([\w"`]+)([^;]*)/gi)) {
    out.push({ name: tableName(m[1]!), columns: [ident(m[2]!)], body: m[3] ?? '' });
  }
  return out;
}

const PERSON_TABLES = new Set(['users', 'user', 'profiles', 'profile', 'accounts', 'customers', 'members']);

/** Table liée à une personne : table de comptes, clé étrangère vers les utilisateurs, ou colonne `user_id` / `owner_id`. */
export function isPersonalTable(t: TableDef): boolean {
  return PERSON_TABLES.has(t.name) || /references\s+(?:auth\.|public\.)?(?:users?|profiles?)\b/i.test(t.body) || t.columns.some((c) => ['user_id', 'owner_id', 'customer_id', 'profile_id'].includes(c));
}

export function parseComments(sqlRaw: string): Classification[] {
  const out: Classification[] = [];
  for (const m of sqlRaw.matchAll(/comment\s+on\s+column\s+([\w."`]+)\.([\w"`]+)\s+is\s+'((?:[^']|'')*)'/gi)) {
    const kv = Object.fromEntries(m[3]!.split(';').map((p) => p.trim()).filter(Boolean).map((p) => [p.split(':')[0]!.trim().toLowerCase(), p.slice(p.indexOf(':') + 1).trim()]));
    if (!kv['pii']) continue;
    out.push({ table: tableName(m[1]!), column: ident(m[2]!), pii: kv['pii']!, ...(kv['purpose'] ? { purpose: kv['purpose'] } : {}), ...(kv['basis'] ? { basis: kv['basis'] } : {}), ...(kv['retention'] ? { retention: kv['retention'] } : {}) });
  }
  return out;
}

/** Problèmes de classification des colonnes d'une table personnelle (vide si tout est classé et complet). */
export function classificationProblems(tables: readonly TableDef[], comments: readonly Classification[]): string[] {
  const byCol = new Map(comments.map((c) => [`${c.table}.${c.column}`, c]));
  const problems: string[] = [];
  for (const t of tables.filter(isPersonalTable)) {
    for (const col of t.columns) {
      const c = byCol.get(`${t.name}.${col}`);
      const key = `${t.name}.${col}`;
      if (!c) problems.push(`${key} : non classée → comment on column ${key} is 'pii:<${PII_CATEGORIES.join('|')}>; purpose:…; basis:<${LEGAL_BASES.join('|')}>; retention:…';`);
      else if (!(PII_CATEGORIES as readonly string[]).includes(c.pii)) problems.push(`${key} : catégorie « ${c.pii} » inconnue (${PII_CATEGORIES.join(', ')})`);
      else if (c.pii !== 'none' && !(c.purpose && c.basis && c.retention)) problems.push(`${key} : pii:${c.pii} exige purpose, basis et retention`);
      else if (c.basis && !(LEGAL_BASES as readonly string[]).includes(c.basis)) problems.push(`${key} : base légale « ${c.basis} » inconnue (${LEGAL_BASES.join(', ')})`);
    }
  }
  return problems;
}

export function renderDataMap(comments: readonly Classification[]): string {
  const rows = comments.filter((c) => c.pii !== 'none').sort((a, b) => `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`));
  return [
    '# Carte des données personnelles',
    '<!-- Générée par `ceng data-map` depuis les commentaires de colonnes des migrations : ne pas éditer. -->',
    '',
    '| Donnée | Catégorie | Finalité | Base légale | Conservation |',
    '|---|---|---|---|---|',
    ...rows.map((c) => `| ${c.table}.${c.column} | ${c.pii} | ${c.purpose ?? ''} | ${c.basis ?? ''} | ${c.retention ?? ''} |`),
    '',
  ].join('\n');
}
