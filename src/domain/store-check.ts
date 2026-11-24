/**
 * Pré-contrôle des magasins (iOS, projets Flutter) : motifs de rejet détectables sans lancer l'application. Ce qui ne se prouve pas
 * par le code (mur d'inscription 5.1.1(v)) reste vérifié par le test visuel (scénario « premier lancement sans compte »).
 * Sources des règles : skill `ios-release` § 0 (pages officielles Apple).
 */

export interface StoreFinding {
  level: 'blocking' | 'confirm';
  guideline: string;
  message: string;
}

export interface StoreInput {
  /** Dépendances du projet (noms de paquets pub). */
  deps: ReadonlySet<string>;
  /** Contenu de ios/Runner/Info.plist (undefined si absent). */
  plist: string | undefined;
  hasPrivacyManifest: boolean;
  /** Texte concaténé du code de l'application (lib/). */
  code: string;
}

/** Paquet → clés d'usage d'`Info.plist` qu'il impose. */
const PERMISSIONS: { pkg: RegExp; keys: string[] }[] = [
  { pkg: /^(camera|image_picker)$/, keys: ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription'] },
  { pkg: /^(geolocator|location)$/, keys: ['NSLocationWhenInUseUsageDescription'] },
  { pkg: /^(record|flutter_sound|speech_to_text)$/, keys: ['NSMicrophoneUsageDescription'] },
  { pkg: /^local_auth$/, keys: ['NSFaceIDUsageDescription'] },
  { pkg: /^(contacts_service|flutter_contacts)$/, keys: ['NSContactsUsageDescription'] },
  { pkg: /^(photo_manager|image_gallery_saver)$/, keys: ['NSPhotoLibraryUsageDescription'] },
];

const SOCIAL = /^(google_sign_in|flutter_facebook_auth|flutter_login_facebook)$/;
const AUTH = /^(supabase_flutter|firebase_auth|google_sign_in|sign_in_with_apple|flutter_facebook_auth|amplify_auth_cognito)$/;
const DELETION = /delete.?account|deleteUser|account.?deletion|supprimer.{0,30}compte|suppression.{0,20}compte/i;
const MIN_PERMISSION_TEXT = 20;

function plistValue(plist: string, key: string): string | undefined {
  return new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist)?.[1];
}

export function checkStore(input: StoreInput): StoreFinding[] {
  const out: StoreFinding[] = [];
  const deps = [...input.deps];
  for (const { pkg, keys } of PERMISSIONS) {
    if (!deps.some((d) => pkg.test(d))) continue;
    for (const key of keys) {
      const text = input.plist === undefined ? undefined : plistValue(input.plist, key);
      if (text === undefined) out.push({ level: 'blocking', guideline: '5.1.1', message: `${key} absent d'Info.plist alors que ${deps.filter((d) => pkg.test(d)).join(', ')} est utilisé : rejet certain, ou plantage à la demande de permission` });
      else if (text.trim().length < MIN_PERMISSION_TEXT) out.push({ level: 'blocking', guideline: '5.1.1', message: `${key} trop court ou générique (« ${text.trim()} ») : dire pourquoi l'application a besoin de cet accès (${MIN_PERMISSION_TEXT} caractères au moins)` });
    }
  }
  if (deps.some((d) => SOCIAL.test(d)) && !deps.includes('sign_in_with_apple')) {
    out.push({ level: 'blocking', guideline: '4.8', message: 'connexion Google ou Facebook sans « Sign in with Apple » (ou service de connexion équivalent respectueux de la vie privée) : à placer en premier, aussi visible que les autres' });
  }
  if (!input.hasPrivacyManifest) out.push({ level: 'blocking', guideline: '5.1.2', message: 'PrivacyInfo.xcprivacy absent de ios/ : manifeste de confidentialité exigé (API à raison requise, SDK tiers)' });
  if (deps.some((d) => AUTH.test(d)) && !DELETION.test(input.code)) {
    out.push({ level: 'blocking', guideline: '5.1.1(v)', message: 'création de compte détectée, aucune suppression de compte dans l\'application : exigée depuis l\'application elle-même' });
  }
  if (deps.some((d) => /^(flutter_stripe|stripe_.*)$/.test(d)) && !deps.some((d) => /^(in_app_purchase|purchases_flutter)$/.test(d))) {
    out.push({ level: 'confirm', guideline: '3.1.1', message: 'paiement par carte sans achat intégré : correct pour un bien ou service consommé hors de l\'application, interdit pour du contenu numérique — à confirmer' });
  }
  return out;
}
