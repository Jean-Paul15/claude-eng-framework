/**
 * Socle de conformité (skill `compliance-by-design`) : les mécanismes obligatoires de tout produit avec comptes ou données
 * personnelles. Un mécanisme est réalisé (fichiers et tests qui existent), écarté par une décision de l'humain, ou manquant.
 */

export interface Mechanism {
  id: string;
  title: string;
  /** Un test doit prouver le mécanisme (sinon fichiers seuls). */
  needsTest: boolean;
}

export const MECHANISMS: readonly Mechanism[] = [
  { id: 'C-01', title: 'Politiques versionnées et ré-acceptation', needsTest: true },
  { id: 'C-02', title: 'Consentement par finalité, retirable', needsTest: false },
  { id: 'C-03', title: 'Carte des données (registre des traitements)', needsTest: false },
  { id: 'C-04', title: 'Conservation et nettoyage automatique', needsTest: true },
  { id: 'C-05', title: 'Droits des personnes : export et suppression de compte', needsTest: true },
  { id: 'C-06', title: "Journal d'audit en ajout seul", needsTest: false },
  { id: 'C-07', title: "Détection d'anomalies", needsTest: true },
  { id: 'C-08', title: 'Réponse à incident (qui est touché ?)', needsTest: true },
  { id: 'C-09', title: 'Authentification et sessions', needsTest: false },
  { id: 'C-10', title: 'Administration et moindre privilège', needsTest: false },
  { id: 'C-11', title: 'Isolation des données', needsTest: true },
  { id: 'C-12', title: 'Registre des tiers et transferts', needsTest: false },
  { id: 'C-13', title: 'Chiffrement, secrets, sauvegardes restaurées', needsTest: false },
  { id: 'C-14', title: 'Journaux sans données personnelles', needsTest: true },
];

export type ComplianceStatus = 'implemented' | 'waived' | 'missing';

export interface ManifestEntry {
  status: Exclude<ComplianceStatus, 'missing'>;
  files?: string[];
  tests?: string[];
  /** Fichier de la décision (`.ceng/brain/decisions/…`) qui écarte le mécanisme. */
  decision?: string;
}
export type Manifest = Record<string, ManifestEntry>;

/** Le socle s'applique dès qu'il y a des comptes ou des données personnelles (domaines de profil ou de tâches). */
export function complianceApplies(domains: readonly string[]): boolean {
  return domains.some((d) => ['auth', 'authorization', 'pii', 'accounts', 'health', 'multi-tenant', 'payments'].includes(d));
}
