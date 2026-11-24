import * as path from 'node:path';
import { assessDependency, depKey, isManifest, parseManifest, type Assessment, type DepMeta, type DepRef, type Ecosystem } from '../domain/deps.js';
import { listFiles, readJson, readText, writeJsonAtomic } from '../infra/fs.js';
import type { BrainStore } from '../brain/store.js';
import type { Task } from '../domain/types.js';

/**
 * Vérification des dépendances : ce qui est déclaré dans les manifestes, ce qui a déjà été vérifié (`.ceng/brain/deps.json`),
 * et la consultation des registres publics (deps.dev pour npm, PyPI, Cargo et Go ; pub.dev ; téléchargements npm).
 * Seuls des NOMS de paquets publics quittent la machine, rien du projet.
 */

export interface VettedEntry {
  verdict: 'ok' | 'review' | 'reject' | 'baseline';
  reasons: string[];
  version?: string;
  license?: string;
  checkedAt: string;
  /** Justification donnée pour garder une dépendance `reject`. */
  accepted?: string;
}
export type VettedFile = Record<string, VettedEntry>;

const vettedPath = (store: BrainStore) => path.join(store.paths.brain, 'deps.json');
export const readVetted = (store: BrainStore): VettedFile | undefined => readJson<VettedFile>(vettedPath(store));
export const writeVetted = (store: BrainStore, v: VettedFile): void => writeJsonAtomic(vettedPath(store), v);

/** Dépendances déclarées dans les manifestes du projet (racine et sous-dossiers jusqu'à 3 niveaux). */
export function currentDeps(root: string): DepRef[] {
  const files = listFiles(root, { maxDepth: 3, maxFiles: 20000 }).files.filter(isManifest);
  const all = files.flatMap((f) => parseManifest(f, readText(path.join(root, f)) ?? ''));
  return [...new Map(all.map((d) => [depKey(d), d])).values()];
}

export function unvettedDeps(store: BrainStore): DepRef[] {
  const vetted = readVetted(store) ?? {};
  return currentDeps(store.paths.root).filter((d) => !(depKey(d) in vetted));
}

/** Première utilisation : les dépendances déjà présentes sont la référence ; seules les suivantes seront vérifiées. */
export function ensureBaseline(store: BrainStore): boolean {
  if (readVetted(store)) return false;
  const at = new Date().toISOString();
  writeVetted(store, Object.fromEntries(currentDeps(store.paths.root).map((d) => [depKey(d), { verdict: 'baseline', reasons: [], checkedAt: at } as VettedEntry])));
  return true;
}

export function runDependenciesGate(store: BrainStore, _task: Task): { status: 'pass' | 'fail'; detail: string } {
  if (ensureBaseline(store)) return { status: 'pass', detail: 'Référence des dépendances créée (celles déjà présentes ne sont pas rejugées).' };
  const missing = unvettedDeps(store);
  if (!missing.length) return { status: 'pass', detail: 'Aucune dépendance ajoutée sans vérification.' };
  return {
    status: 'fail',
    detail: `Dépendance(s) non vérifiée(s) : ${missing.map((d) => d.name).join(', ')}. Lancer \`ceng dep check\` (licence, maintenance, vulnérabilités, popularité) puis citer le choix dans le rapport.`,
  };
}

// ---------------------------------------------------------------- Registres

const UA = { 'user-agent': 'ceng-dependency-check' };

async function getJson<T>(url: string): Promise<T | undefined> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

interface DepsDevVersions { versions: { versionKey: { version: string }; publishedAt?: string; isDefault?: boolean; isDeprecated?: boolean; deprecatedReason?: string }[] }
interface DepsDevVersion { licenses?: string[]; advisoryKeys?: unknown[] }

const DEPS_DEV: Partial<Record<Ecosystem, string>> = { npm: 'npm', pypi: 'pypi', cargo: 'cargo', go: 'go' };

async function metaFromDepsDev(eco: Ecosystem, name: string): Promise<DepMeta | undefined> {
  const base = `https://api.deps.dev/v3/systems/${DEPS_DEV[eco]}/packages/${encodeURIComponent(name)}`;
  const pkg = await getJson<DepsDevVersions>(base);
  if (!pkg?.versions?.length) return undefined;
  const dated = pkg.versions.filter((v) => v.publishedAt).sort((a, b) => a.publishedAt!.localeCompare(b.publishedAt!));
  const current = pkg.versions.find((v) => v.isDefault) ?? dated.at(-1)!;
  const detail = await getJson<DepsDevVersion>(`${base}/versions/${encodeURIComponent(current.versionKey.version)}`);
  const meta: DepMeta = {
    name, eco, version: current.versionKey.version, versions: pkg.versions.length,
    ...(detail?.licenses?.length ? { license: detail.licenses.join(' OR ') } : {}),
    ...(current.isDeprecated ? { deprecated: current.deprecatedReason || 'dépréciée' } : {}),
    ...(dated.at(-1)?.publishedAt ? { lastPublish: dated.at(-1)!.publishedAt! } : {}),
    ...(dated[0]?.publishedAt ? { firstPublish: dated[0].publishedAt } : {}),
    advisories: detail?.advisoryKeys?.length ?? 0,
  };
  if (eco === 'npm') {
    const dl = await getJson<{ downloads?: number }>(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name).replace('%40', '@')}`).catch(() => undefined);
    if (dl?.downloads !== undefined) meta.weeklyDownloads = dl.downloads;
  }
  return meta;
}

async function metaFromPub(name: string): Promise<DepMeta | undefined> {
  const pkg = await getJson<{ latest: { version: string; published?: string }; isDiscontinued?: boolean; replacedBy?: string }>(`https://pub.dev/api/packages/${encodeURIComponent(name)}`);
  if (!pkg) return undefined;
  const score = await getJson<{ tags?: string[]; downloadCount30Days?: number }>(`https://pub.dev/api/packages/${encodeURIComponent(name)}/score`).catch(() => undefined);
  const license = score?.tags?.find((t) => t.startsWith('license:') && !['license:fsf-libre', 'license:osi-approved', 'license:unknown'].includes(t))?.slice(8).toUpperCase();
  return {
    name, eco: 'pub', version: pkg.latest.version,
    ...(license ? { license } : {}),
    ...(pkg.isDiscontinued ? { deprecated: `abandonné${pkg.replacedBy ? `, remplacé par ${pkg.replacedBy}` : ''}` } : {}),
    ...(pkg.latest.published ? { lastPublish: pkg.latest.published } : {}),
    ...(score?.downloadCount30Days !== undefined ? { weeklyDownloads: Math.round(score.downloadCount30Days / 4) } : {}),
  };
}

export interface CheckResult {
  dep: DepRef;
  assessment: Assessment;
  meta?: DepMeta;
  /** Registre injoignable : le jugement est impossible, ce n'est pas un feu vert. */
  error?: string;
}

export async function checkDependency(dep: DepRef): Promise<CheckResult> {
  try {
    const meta = dep.eco === 'pub' ? await metaFromPub(dep.name) : await metaFromDepsDev(dep.eco, dep.name);
    if (!meta) return { dep, assessment: { verdict: 'reject', reasons: ['introuvable dans le registre public : nom mal orthographié ou paquet usurpé (typosquatting) ?'] } };
    return { dep, meta, assessment: assessDependency(meta) };
  } catch (err) {
    return { dep, error: (err as Error).message, assessment: { verdict: 'review', reasons: [`registre injoignable (${(err as Error).message}) : vérification impossible, à refaire`] } };
  }
}

export function recordCheck(store: BrainStore, r: CheckResult, accepted?: string): boolean {
  if (r.error) return false;
  if (r.assessment.verdict === 'reject' && !accepted) return false;
  const vetted = readVetted(store) ?? {};
  vetted[depKey(r.dep)] = {
    verdict: r.assessment.verdict, reasons: r.assessment.reasons, checkedAt: new Date().toISOString(),
    ...(r.meta?.version ? { version: r.meta.version } : {}), ...(r.meta?.license ? { license: r.meta.license } : {}), ...(accepted ? { accepted } : {}),
  };
  writeVetted(store, vetted);
  return true;
}
