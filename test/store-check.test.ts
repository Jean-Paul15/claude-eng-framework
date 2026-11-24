import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { checkStore } from '../src/domain/store-check.js';

const PLIST = (extra = '') => `<plist><dict>${extra}</dict></plist>`;
const base = { deps: new Set<string>(), plist: PLIST(), hasPrivacyManifest: true, code: '' };
const ids = (i: Parameters<typeof checkStore>[0]) => checkStore(i).map((f) => f.guideline);

describe('pré-contrôle des magasins (N-05)', () => {
  it('permission sans texte, ou texte générique', () => {
    assert.deepEqual(ids({ ...base, deps: new Set(['image_picker']) }), ['5.1.1', '5.1.1']);
    const plist = PLIST('<key>NSCameraUsageDescription</key><string>Camera</string><key>NSPhotoLibraryUsageDescription</key><string>Choisir une photo de profil dans votre photothèque</string>');
    const f = checkStore({ ...base, deps: new Set(['image_picker']), plist });
    assert.equal(f.length, 1);
    assert.match(f[0]!.message, /trop court/);
  });
  it('connexion sociale sans Sign in with Apple (4.8)', () => {
    assert.ok(ids({ ...base, deps: new Set(['google_sign_in']), code: 'deleteAccount()' }).includes('4.8'));
    assert.ok(!ids({ ...base, deps: new Set(['google_sign_in', 'sign_in_with_apple']), code: 'deleteAccount()' }).includes('4.8'));
  });
  it('suppression de compte (5.1.1(v)) et manifeste de confidentialité (5.1.2)', () => {
    assert.ok(ids({ ...base, deps: new Set(['supabase_flutter']) }).includes('5.1.1(v)'));
    assert.ok(!ids({ ...base, deps: new Set(['supabase_flutter']), code: 'Future<void> deleteAccount() async {}' }).includes('5.1.1(v)'));
    assert.ok(ids({ ...base, hasPrivacyManifest: false }).includes('5.1.2'));
  });
  it('paiement par carte sans achat intégré : à confirmer, pas bloquant', () => {
    const f = checkStore({ ...base, deps: new Set(['flutter_stripe']) });
    assert.equal(f[0]!.level, 'confirm');
    assert.equal(f[0]!.guideline, '3.1.1');
  });
  it('projet propre : rien', () => assert.deepEqual(checkStore(base), []));
});
