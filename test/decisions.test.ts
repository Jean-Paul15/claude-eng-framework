import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { listDecisions, relevantDecisions } from '../src/app/decisions.js';
import { BrainStore } from '../src/brain/store.js';
import { cli, rm, sandbox } from './helpers.js';

let dir = '';
let store: BrainStore;
const adr = (n: number, title: string, status = 'accepted', body = '') =>
  fs.writeFileSync(path.join(dir, '.ceng/brain/decisions', `${String(n).padStart(4, '0')}-d.md`), `# ${title}\n\nstatut : ${status}\n\n${body}\n`);

before(() => {
  dir = sandbox('api-backend');
  assert.equal(cli(dir, ['init', '--yes', '--goal', 'API']).code, 0);
  store = new BrainStore(dir);
});
after(() => rm(dir));

describe('décisions pertinentes pour une tâche', () => {
  it('dossier vide : aucune décision', () => {
    assert.deepEqual(relevantDecisions(store, { title: 'x', domains: [], files: [] }), []);
  });

  it('exclut les décisions remplacées ou rejetées', () => {
    adr(1, 'Paiement : Stripe Connect');
    adr(2, 'Paiement : PayPal', 'remplacée');
    adr(3, 'Export CSV', 'rejetée');
    assert.deepEqual(listDecisions(store).map((d) => d.title), ['Paiement : Stripe Connect']);
  });

  it('garde la plus ancienne si elle concerne la tâche, plafonne à 8', () => {
    for (let i = 4; i <= 22; i++) adr(i, `Écran ${i} des réglages du profil`, 'accepted', 'mise en page');
    const got = relevantDecisions(store, { title: 'Paiement par carte', domains: ['payments'], files: [] });
    assert.ok(got.length <= 8);
    assert.ok(got.some((d) => d.title.includes('Stripe')), 'la décision n° 1 reste visible');
  });
});
