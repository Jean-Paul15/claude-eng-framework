import * as path from 'node:path';
import { complianceApplies, MECHANISMS, type ComplianceStatus, type Manifest, type Mechanism } from '../domain/compliance.js';
import { exists, readJson, writeJsonAtomic } from '../infra/fs.js';
import { listDecisions } from './decisions.js';
import type { BrainStore } from '../brain/store.js';

/** Manifeste de conformité `.ceng/brain/compliance.json` et sa vérification (les fichiers et tests cités existent ; la décision d'écart aussi). */

const manifestPath = (store: BrainStore) => path.join(store.paths.brain, 'compliance.json');
export const readManifest = (store: BrainStore): Manifest => readJson<Manifest>(manifestPath(store)) ?? {};
export const writeManifest = (store: BrainStore, m: Manifest): void => writeJsonAtomic(manifestPath(store), m);

export interface ComplianceRow {
  mechanism: Mechanism;
  status: ComplianceStatus;
  detail: string;
}

export function applies(store: BrainStore): boolean {
  const domains = [...(store.profile()?.domains.map((d) => d.name) ?? []), ...store.tasks().flatMap((t) => t.domains)];
  return complianceApplies(domains);
}

export function checkCompliance(store: BrainStore): ComplianceRow[] {
  const manifest = readManifest(store);
  const alive = new Set(listDecisions(store).map((d) => d.file));
  return MECHANISMS.map((mechanism) => {
    const e = manifest[mechanism.id];
    if (!e) return { mechanism, status: 'missing' as const, detail: 'non déclaré' };
    if (e.status === 'waived') {
      const ok = Boolean(e.decision) && alive.has(path.basename(e.decision!));
      return ok ? { mechanism, status: 'waived' as const, detail: `écarté : ${e.decision}` } : { mechanism, status: 'missing' as const, detail: `décision d'écart introuvable ou rejetée (${e.decision ?? 'aucune'})` };
    }
    const absent = [...(e.files ?? []), ...(e.tests ?? [])].filter((f) => !exists(path.join(store.paths.root, f)));
    if (!e.files?.length) return { mechanism, status: 'missing' as const, detail: 'aucun fichier déclaré' };
    if (mechanism.needsTest && !e.tests?.length) return { mechanism, status: 'missing' as const, detail: 'test exigé et non déclaré' };
    if (absent.length) return { mechanism, status: 'missing' as const, detail: `fichier(s) introuvable(s) : ${absent.join(', ')}` };
    return { mechanism, status: 'implemented' as const, detail: (e.files ?? []).join(', ') };
  });
}

/** Mécanismes à construire : vide quand le socle ne s'applique pas ou qu'il est complet. */
export function missingMechanisms(store: BrainStore): ComplianceRow[] {
  return applies(store) ? checkCompliance(store).filter((r) => r.status === 'missing') : [];
}
