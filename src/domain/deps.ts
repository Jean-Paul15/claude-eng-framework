/**
 * Dépendances : lecture des manifestes (sans dépendance) et jugement d'une dépendance d'après les métadonnées de son registre.
 * Pur et déterministe ; l'accès réseau vit dans `app/deps.ts`.
 */

export type Ecosystem = 'npm' | 'pypi' | 'cargo' | 'go' | 'pub';

export interface DepRef {
  name: string;
  eco: Ecosystem;
  dev: boolean;
}

export const MANIFESTS: Record<string, Ecosystem> = {
  'package.json': 'npm',
  'pubspec.yaml': 'pub',
  'requirements.txt': 'pypi',
  'pyproject.toml': 'pypi',
  'Cargo.toml': 'cargo',
  'go.mod': 'go',
};

export const depKey = (d: Pick<DepRef, 'eco' | 'name'>): string => `${d.eco}:${d.name}`;

const basename = (file: string): string => file.replace(/\\/g, '/').split('/').pop() ?? file;
export const isManifest = (file: string): boolean => basename(file) in MANIFESTS;

const LOCAL_SPEC = /^(file:|link:|workspace:|portal:)/;

function parsePackageJson(text: string): DepRef[] {
  let json: Record<string, Record<string, string> | undefined>;
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    return [];
  }
  const out: DepRef[] = [];
  for (const [section, dev] of [['dependencies', false], ['optionalDependencies', false], ['devDependencies', true]] as const) {
    for (const [name, spec] of Object.entries(json[section] ?? {})) if (!LOCAL_SPEC.test(String(spec))) out.push({ name, eco: 'npm', dev });
  }
  return out;
}

const PUB_SDK = new Set(['flutter', 'flutter_test', 'flutter_localizations', 'flutter_driver', 'flutter_web_plugins', 'integration_test']);

function parsePubspec(text: string): DepRef[] {
  const lines = text.split(/\r?\n/);
  const out: DepRef[] = [];
  let dev: boolean | undefined;
  lines.forEach((line, i) => {
    if (/^dependencies:/.test(line)) dev = false;
    else if (/^dev_dependencies:/.test(line)) dev = true;
    else if (/^\S/.test(line)) dev = undefined;
    const m = dev === undefined ? null : /^ {2}([a-z0-9_]+):\s*(.*)$/.exec(line);
    if (!m || PUB_SDK.has(m[1]!)) return;
    const nested: string[] = [];
    for (const l of lines.slice(i + 1)) {
      if (!/^ {3,}\S/.test(l)) break;
      nested.push(l);
    }
    const next = nested.join(' ');
    if (/\b(sdk|path|git):/.test(`${m[2]} ${next}`)) return;
    out.push({ name: m[1]!, eco: 'pub', dev: dev! });
  });
  return out;
}

const pyName = (spec: string): string | undefined => {
  const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(spec);
  return m ? m[1]!.toLowerCase().replace(/[_.]+/g, '-') : undefined;
};

function parseRequirements(text: string): DepRef[] {
  const out: DepRef[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line || line.startsWith('-') || /^(https?|git\+|file:)/.test(line)) continue;
    const name = pyName(line);
    if (name) out.push({ name, eco: 'pypi', dev: false });
  }
  return out;
}

function parsePyproject(text: string): DepRef[] {
  const out: DepRef[] = [];
  const array = /^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(text);
  if (array) for (const s of array[1]!.matchAll(/["']([^"']+)["']/g)) {
    const name = pyName(s[1]!);
    if (name) out.push({ name, eco: 'pypi', dev: false });
  }
  const poetry = /^\[tool\.poetry\.dependencies\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(text);
  if (poetry) for (const l of poetry[1]!.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/.exec(l);
    if (m && m[1]!.toLowerCase() !== 'python' && !/path\s*=/.test(l)) out.push({ name: pyName(m[1]!)!, eco: 'pypi', dev: false });
  }
  return out;
}

function parseCargo(text: string): DepRef[] {
  const out: DepRef[] = [];
  let dev: boolean | undefined;
  for (const line of text.split(/\r?\n/)) {
    const section = /^\[([^\]]+)\]/.exec(line);
    if (section) {
      dev = section[1] === 'dependencies' || section[1] === 'build-dependencies' ? false : section[1] === 'dev-dependencies' ? true : undefined;
      continue;
    }
    const m = dev === undefined ? null : /^([A-Za-z0-9_-]+)\s*(=|\.workspace)/.exec(line);
    if (m && !/path\s*=/.test(line)) out.push({ name: m[1]!, eco: 'cargo', dev: dev! });
  }
  return out;
}

function parseGoMod(text: string): DepRef[] {
  const out: DepRef[] = [];
  let block = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^require\s*\($/.test(line)) block = true;
    else if (block && line === ')') block = false;
    const m = block ? /^(\S+)\s+v\S+/.exec(line) : /^require\s+(\S+)\s+v\S+/.exec(line);
    if (m && !/\/\/\s*indirect/.test(line)) out.push({ name: m[1]!, eco: 'go', dev: false });
  }
  return out;
}

/** Dépendances déclarées par un manifeste (selon son nom de fichier) ; sans doublon. */
export function parseManifest(file: string, text: string): DepRef[] {
  const base = basename(file);
  const list =
    base === 'package.json' ? parsePackageJson(text)
    : base === 'pubspec.yaml' ? parsePubspec(text)
    : base === 'requirements.txt' ? parseRequirements(text)
    : base === 'pyproject.toml' ? parsePyproject(text)
    : base === 'Cargo.toml' ? parseCargo(text)
    : base === 'go.mod' ? parseGoMod(text)
    : [];
  return [...new Map(list.map((d) => [depKey(d), d])).values()];
}

// ---------------------------------------------------------------- Jugement

export interface DepMeta {
  name: string;
  eco: Ecosystem;
  version?: string;
  license?: string;
  /** Raison de dépréciation ou d'abandon (vide si la dépendance est maintenue). */
  deprecated?: string;
  lastPublish?: string;
  firstPublish?: string;
  versions?: number;
  /** Vulnérabilités connues de la version courante. */
  advisories?: number;
  weeklyDownloads?: number;
}

export type Verdict = 'ok' | 'review' | 'reject';

export interface Assessment {
  verdict: Verdict;
  reasons: string[];
}

const STRONG_COPYLEFT = /\b(AGPL|SSPL|GPL|EUPL|OSL|CC-BY-SA|BUSL)\b/i;
const WEAK_COPYLEFT = /\b(LGPL|MPL|EPL|CDDL)\b/i;
const DAY = 86_400_000;

/**
 * `reject` : à ne pas ajouter sans justification explicite de l'humain ou de l'orchestrateur (`--accept`) ;
 * `review` : ajout possible, mais le risque est à nommer dans le rapport ; `ok` : rien à signaler.
 */
export function assessDependency(m: DepMeta, now = Date.now()): Assessment {
  const reject: string[] = [];
  const review: string[] = [];
  if (m.deprecated) reject.push(`dépréciée ou abandonnée : ${m.deprecated}`);
  if (m.advisories) reject.push(`${m.advisories} vulnérabilité(s) connue(s) sur la version courante ${m.version ?? ''}`.trim());
  if (!m.license) reject.push('licence absente ou inconnue : usage juridiquement incertain');
  else if (STRONG_COPYLEFT.test(m.license)) reject.push(`licence ${m.license} : copyleft fort, décision humaine si le projet n'est pas sous la même licence`);
  else if (WEAK_COPYLEFT.test(m.license)) review.push(`licence ${m.license} : copyleft faible, vérifier les obligations (modifications, notices)`);
  const last = m.lastPublish ? Date.parse(m.lastPublish) : NaN;
  if (Number.isFinite(last) && now - last > 730 * DAY) review.push(`aucune publication depuis ${Math.round((now - last) / (30 * DAY))} mois : maintenance incertaine`);
  const first = m.firstPublish ? Date.parse(m.firstPublish) : NaN;
  if (Number.isFinite(first) && now - first < 90 * DAY && (m.versions ?? 99) <= 3) review.push('très récente et très peu de versions : vérifier le nom (usurpation) et la source');
  if (m.weeklyDownloads !== undefined && m.weeklyDownloads < 1000) review.push(`peu utilisée (${m.weeklyDownloads} téléchargements par semaine) : une alternative plus répandue existe-t-elle ?`);
  if (m.version && /^0\./.test(m.version)) review.push(`version ${m.version} (< 1.0) : API susceptible de changer`);
  return reject.length ? { verdict: 'reject', reasons: [...reject, ...review] } : review.length ? { verdict: 'review', reasons: review } : { verdict: 'ok', reasons: [] };
}
