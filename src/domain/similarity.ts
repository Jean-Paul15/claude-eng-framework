/**
 * Recherche de l'existant proche d'une demande, pour réutiliser ou étendre au lieu de dupliquer une fonctionnalité.
 * Pur : tokenisation, synonymes métier courants (FR/EN), extraction des symboles déclarés, score.
 */

/** Familles de mots qui désignent la même chose dans un code (anglais) et dans une demande (souvent en français). */
const SYNONYM_GROUPS: readonly string[][] = [
  ['user', 'utilisateur', 'account', 'compte', 'profile', 'profil', 'member', 'membre', 'customer', 'client'],
  ['auth', 'login', 'signin', 'connexion', 'session', 'logout', 'signup', 'inscription', 'register', 'password', 'motdepasse'],
  ['order', 'commande', 'purchase', 'achat', 'checkout'],
  ['payment', 'paiement', 'pay', 'billing', 'facturation', 'stripe', 'charge'],
  ['invoice', 'facture', 'receipt', 'recu'],
  ['product', 'produit', 'item', 'article', 'catalog', 'catalogue'],
  ['cart', 'panier', 'basket'],
  ['notification', 'notif', 'alert', 'alerte', 'push', 'toast'],
  ['message', 'chat', 'conversation', 'discussion', 'inbox'],
  ['settings', 'parametres', 'parametre', 'preferences', 'config', 'configuration', 'options', 'reglages'],
  ['search', 'recherche', 'filter', 'filtre', 'query'],
  ['upload', 'televersement', 'file', 'fichier', 'attachment', 'piece', 'media', 'image', 'photo'],
  ['dashboard', 'tableau', 'overview', 'apercu', 'stats', 'statistiques', 'analytics', 'metrics'],
  ['list', 'liste', 'table', 'grid', 'index'],
  ['form', 'formulaire', 'input', 'saisie', 'field', 'champ'],
  ['modal', 'dialog', 'popup', 'sheet', 'drawer'],
  ['delete', 'supprimer', 'suppression', 'remove', 'destroy'],
  ['create', 'creer', 'creation', 'add', 'ajouter', 'new', 'nouveau'],
  ['update', 'modifier', 'modification', 'edit', 'editer', 'patch'],
  ['email', 'mail', 'courriel'],
  ['role', 'permission', 'droit', 'acl', 'rbac', 'admin', 'backoffice'],
  ['subscription', 'abonnement', 'plan', 'tier', 'offre'],
  ['booking', 'reservation', 'reserver', 'appointment', 'rendezvous', 'slot', 'creneau'],
  ['map', 'carte', 'location', 'localisation', 'geo', 'address', 'adresse'],
  ['report', 'rapport', 'export', 'pdf', 'csv'],
  ['schedule', 'planning', 'calendar', 'calendrier', 'agenda', 'cron'],
];

const SYNONYMS = new Map<string, readonly string[]>();
for (const group of SYNONYM_GROUPS) for (const w of group) SYNONYMS.set(w, group);

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'les', 'des', 'une', 'pour', 'avec', 'dans', 'sur', 'par', 'qui', 'que', 'aux', 'est', 'page', 'ecran', 'screen', 'feature', 'fonctionnalite', 'faire', 'ajout', 'get', 'set', 'src', 'lib', 'app', 'index', 'test', 'tests', 'spec', 'main', 'utils']);

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Découpe un texte ou un identifiant (camelCase, snake_case, kebab-case, chemins) en mots normalisés au singulier. */
export function tokenize(text: string): string[] {
  const spaced = stripAccents(text)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase();
  return spaced
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

/** Termes de la demande et leurs synonymes : `exact` pèse plus qu'un synonyme. */
export function expandTerms(query: string): { exact: Set<string>; related: Set<string> } {
  const exact = new Set(tokenize(query));
  const related = new Set<string>();
  for (const w of exact) for (const s of SYNONYMS.get(w) ?? []) if (!exact.has(s)) related.add(s);
  return { exact, related };
}

export interface DeclaredSymbol {
  name: string;
  line: number;
  kind: string;
}

const DECLARATION = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:public\s+|private\s+|protected\s+|static\s+|abstract\s+|final\s+)*(function|class|interface|type|enum|const|let|def|fun|func|struct|trait|mixin|extension|record)\s+([A-Za-z_][A-Za-z0-9_]*)/;
const ROUTE = /['"`](\/(?:api\/)?[a-z0-9_\-/:{}]+)['"`]/i;
const SQL_TABLE = /\bcreate\s+(?:table|view|materialized\s+view|function)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?["`]?([a-z_][a-z0-9_]*)/i;

/** Symboles déclarés (fonctions, classes, composants, types, routes, tables SQL) d'un fichier source. */
export function extractSymbols(content: string, maxLines = 4000): DeclaredSymbol[] {
  const out: DeclaredSymbol[] = [];
  const lines = content.split(/\r?\n/, maxLines);
  lines.forEach((text, i) => {
    const d = DECLARATION.exec(text);
    if (d) out.push({ name: d[2]!, line: i + 1, kind: d[1]! });
    const sql = SQL_TABLE.exec(text);
    if (sql) out.push({ name: sql[1]!, line: i + 1, kind: 'sql' });
    const route = ROUTE.exec(text);
    if (route && /\b(get|post|put|patch|delete|route|path|href|navigate|push|router|endpoint|fetch)\b/i.test(text)) out.push({ name: route[1]!, line: i + 1, kind: 'route' });
  });
  return out;
}

export interface Candidate {
  file: string;
  score: number;
  symbols: DeclaredSymbol[];
}

/** Score d'un ensemble de mots contre la demande : 3 par terme exact, 1 par synonyme, chaque terme compté une fois. */
export function scoreWords(words: readonly string[], terms: ReturnType<typeof expandTerms>): number {
  const seen = new Set(words);
  let score = 0;
  for (const t of terms.exact) if (seen.has(t)) score += 3;
  for (const t of terms.related) if (seen.has(t)) score += 1;
  return score;
}

/** Classe un fichier : chemin (poids double : un dossier `orders/` dit beaucoup) + symboles déclarés pertinents. */
export function scoreFile(file: string, symbols: readonly DeclaredSymbol[], terms: ReturnType<typeof expandTerms>): Candidate {
  const pathScore = scoreWords(tokenize(file), terms) * 2;
  const relevant = symbols
    .map((s) => ({ s, score: scoreWords(tokenize(s.name), terms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const symbolScore = relevant.slice(0, 5).reduce((acc, x) => acc + x.score, 0);
  return { file, score: pathScore + symbolScore, symbols: relevant.slice(0, 5).map((x) => x.s) };
}
