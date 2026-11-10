import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { expandTerms, extractSymbols, tokenize } from '../src/domain/similarity.js';
import { findSimilar } from '../src/app/similar.js';
import { cli, rm, sandbox } from './helpers.js';

const dirs: string[] = [];
after(() => dirs.forEach(rm));

describe('existant proche (anti-doublon)', () => {
  it('tokenise identifiants et texte, sans accents, au singulier', () => {
    assert.deepEqual(tokenize('OrderHistoryList'), ['order', 'history', 'list']);
    assert.deepEqual(tokenize('écran des commandes_récentes'), ['commande', 'recente']);
  });

  it('relie une demande en français au code en anglais par les synonymes', () => {
    const t = expandTerms('historique des commandes');
    assert.ok(t.exact.has('commande'));
    assert.ok(t.related.has('order'));
  });

  it('extrait fonctions, composants, tables SQL et routes', () => {
    const syms = extractSymbols([
      'export function OrderCard() {}',
      'export const useOrders = () => {}',
      'CREATE TABLE IF NOT EXISTS public.orders (id int);',
      "router.get('/api/orders/:id', handler)",
    ].join('\n'));
    assert.deepEqual(syms.map((s) => `${s.kind}:${s.name}`), ['function:OrderCard', 'const:useOrders', 'sql:orders', 'route:/api/orders/:id']);
  });

  it('trouve le module existant et ignore tests, dépendances et fichiers exclus', () => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env['TEMP'] ?? '/tmp'), 'ceng-sim-'));
    dirs.push(dir);
    const write = (rel: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    };
    write('src/orders/OrderList.tsx', 'export function OrderList() { return null }\n');
    write('src/orders/OrderList.test.tsx', 'export function OrderListTest() {}\n');
    write('node_modules/x/orders.js', 'export function orders() {}\n');
    write('src/profile/Avatar.tsx', 'export function Avatar() {}\n');
    const found = findSimilar(dir, 'liste des commandes');
    assert.deepEqual(found.map((c) => c.file), ['src/orders/OrderList.tsx']);
    assert.deepEqual(findSimilar(dir, 'liste des commandes', { exclude: (f) => f.startsWith('src/orders') }), []);
  });

  it('ceng brief : paquet minimal avec périmètre, références et existant à réutiliser', () => {
    const dir = sandbox('web-shop');
    dirs.push(dir);
    assert.equal(cli(dir, ['init', '--yes']).code, 0);
    fs.mkdirSync(path.join(dir, 'ref'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'ref', 'cart.ts'), 'export function addToCart() {}\n');
    const add = cli(dir, ['task', 'add', '--title', 'Panier : ajouter un produit', '--kind', 'feature', '--files', 'src/cart/**', '--accept', 'le produit apparaît dans le panier', '--json']);
    assert.equal(add.code, 0, add.stderr);
    const id = (JSON.parse(add.stdout) as { id: string }).id;
    const r = cli(dir, ['brief', id, '--ref', 'ref/cart.ts']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`Tâche ${id}`));
    assert.match(r.stdout, /Références à reprendre et adapter[\s\S]*ref\/cart\.ts/);
    assert.match(r.stdout, /src\/cart\/\*\*/);
    assert.match(r.stdout, /reuse:/);
    assert.notEqual(cli(dir, ['brief', id, '--ref', 'absent.ts']).code, 0);
  });
});
