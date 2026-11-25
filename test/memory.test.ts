import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { cli, json, rm, runtimeHook, sandbox } from './helpers.js';
import type { Feature } from '../src/app/features.js';

let dir = '';
const run = (...a: string[]) => cli(dir, a);
const prompt = (text: string, session = 's1') => {
  const r = runtimeHook(dir, 'user-prompt', { prompt: text, session_id: session });
  return r.stdout ? (JSON.parse(r.stdout).hookSpecificOutput?.additionalContext as string) : '';
};

before(() => {
  dir = sandbox('api-backend');
  assert.equal(cli(dir, ['init', '--yes', '--goal', 'API']).code, 0);
});
after(() => rm(dir));

describe('registre des fonctionnalités', () => {
  it('ajoute, rattache une tâche, passe en cours puis livrée', () => {
    assert.equal(run('feature', 'add', '--name', 'Paiement par carte', '--summary', 'Payer une commande avec une carte bancaire', '--keywords', 'checkout,stripe').code, 0);
    assert.equal(run('task', 'add', '--title', 'Formulaire de paiement', '--kind', 'chore', '--feature', 'F-001', '--files', 'pay/**').code, 0);
    assert.equal(json<Feature[]>(run('feature', 'list', '--json'))[0]!.status, 'in_progress');
    assert.ok(fs.existsSync(path.join(dir, '.ceng/brain/FEATURES.md')));
    assert.equal(run('task', 'done', 'T-0001', '--evidence', 'x', '--waive', 'test').code, 0);
    const f = json<Feature[]>(run('feature', 'list', '--json'))[0]!;
    assert.equal(f.status, 'delivered');
    assert.deepEqual(f.files, ['pay/**']);
  });

  it('écarter exige une raison ; rattacher à une fonctionnalité inconnue échoue', () => {
    run('feature', 'add', '--name', 'Paiement en plusieurs fois', '--summary', 'Payer en trois mensualités');
    assert.notEqual(run('feature', 'reject', 'F-002').code, 0);
    assert.equal(run('feature', 'reject', 'F-002', '--reason', 'frais du prestataire trop élevés').code, 0);
    assert.notEqual(run('task', 'add', '--title', 'X', '--feature', 'F-099').code, 0);
  });

  it('importe des fonctionnalités depuis les groupes de tâches', () => {
    run('task', 'add', '--title', 'Export CSV des commandes', '--kind', 'chore', '--group', 'export');
    assert.match(run('feature', 'import').stdout, /export/);
    assert.equal(run('feature', 'import').stdout.includes('Rien'), true);
  });
});

describe('garde anti-doublon à la création', () => {
  it('refuse une tâche feature proche d\'une existante, avec les trois issues', () => {
    const r = run('task', 'add', '--title', 'Paiement par carte bancaire', '--kind', 'feature');
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /--extends/);
    assert.match(r.stderr, /--new/);
  });
  it('accepte avec --extends, --feature ou --new ; ignore bug et chore', () => {
    assert.equal(run('task', 'add', '--title', 'Paiement par carte bancaire 3DS', '--kind', 'feature', '--extends', 'F-001').code, 0);
    assert.equal(run('task', 'add', '--title', 'Paiement carte bancaire autre', '--kind', 'feature', '--new', 'autre prestataire, autre flux').code, 0);
    assert.equal(run('task', 'add', '--title', 'Paiement par carte bancaire : correctif', '--kind', 'bug').code, 0);
  });
});

describe('rappel à chaque demande, ceng similar, réponses et décisions', () => {
  it('rappelle la fonctionnalité livrée par synonyme, et l\'écartée en insistant', () => {
    const livree = prompt('on peut ajouter un checkout avec la carte pour les clients ?');
    assert.match(livree, /F-001/);
    assert.match(prompt('ajoutons le paiement en plusieurs fois mensualités', 's2'), /ÉCARTÉE/);
  });
  it('silencieux pour une réponse courte ou une commande, et sans répétition', () => {
    assert.equal(prompt('oui continue'), '');
    assert.equal(prompt('/ceng-orchestrate paiement carte'), '');
    assert.equal(prompt('le paiement par carte fonctionne bien ?', 's3').includes('F-001'), true);
    assert.equal(prompt('le paiement par carte fonctionne bien ?', 's3').includes('F-001'), false);
  });
  it('ceng similar commence par la mémoire du projet', () => {
    assert.match(run('similar', 'paiement', 'carte').stdout, /Déjà dans la mémoire/);
  });
  it('journal des réponses : consigné, permission du framework exclue, retrouvé par le rappel', () => {
    runtimeHook(dir, 'question-answered', { tool_name: 'AskUserQuestion', tool_response: { answers: { 'Livraison à domicile ?': 'Non, retrait en magasin seulement', 'Permission R-0001 ?': 'Approuver R-0001' } } });
    const log = fs.readFileSync(path.join(dir, '.ceng/brain/answers.md'), 'utf8');
    assert.match(log, /retrait en magasin/);
    assert.ok(!log.includes('R-0001'));
    assert.match(prompt('on propose la livraison à domicile finalement', 's4'), /Réponse déjà donnée/);
  });
  it('decision supersede / reject : la décision sort des briefs et du rappel', () => {
    run('decision', 'add', '--title', 'Prestataire de recherche : Algolia', '--context', 'c', '--decision', 'd', '--consequences', 'q');
    run('decision', 'add', '--title', 'Prestataire de recherche : Typesense', '--context', 'c', '--decision', 'd', '--consequences', 'q');
    assert.match(prompt('quel prestataire de recherche pour le catalogue produits ?', 's5'), /Algolia/);
    assert.equal(run('decision', 'supersede', 'ADR-0001', '--by', 'ADR-0002', '--reason', 'coût').code, 0);
    assert.doesNotMatch(prompt('et le prestataire de recherche du catalogue produits ?', 's6'), /Algolia/);
    assert.notEqual(run('decision', 'reject', 'ADR-0002').code, 0);
  });
});

describe('tableau de bord HTML (N-03)', () => {
  it('page autonome : ce qui attend l\'humain en tête, rien d\'externe, secrets masqués', () => {
    run('task', 'add', '--title', 'Choix prestataire', '--kind', 'chore');
    run('task', 'block', 'T-0006', '--reason', 'décision métier');
    fs.mkdirSync(path.join(dir, '.ceng/shots/T-0001/parcours'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.ceng/shots/T-0001/parcours/01_390.png'), 'png');
    assert.equal(run('report', '--html').code, 0);
    const html = fs.readFileSync(path.join(dir, '.ceng/report/index.html'), 'utf8');
    assert.match(html, /Ce qui t'attend/);
    assert.match(html, /décision métier/);
    assert.match(html, /\.\.\/shots\/T-0001\/parcours\/01_390\.png/);
    assert.match(html, /prefers-color-scheme:dark/);
    assert.ok(!/https?:\/\//.test(html), 'aucune ressource externe');
  });
  it('Markdown rendu, coupe à un mot entier, rubrique longue repliée', () => {
    const long = `**Gras** et \`code\` ${'mot '.repeat(150)}fin`;
    fs.appendFileSync(path.join(dir, '.ceng/brain/pending-approvals.md'), [1, 2, 3, 4, 5, 6].map((n) => `- [ ] ${n === 1 ? long : `Action ${n}`}\n`).join(''));
    assert.equal(run('report', '--html').code, 0);
    const html = fs.readFileSync(path.join(dir, '.ceng/report/index.html'), 'utf8');
    assert.match(html, /<strong>Gras<\/strong> et <code>code<\/code>/);
    assert.doesNotMatch(html, /\*\*Gras|`code`/);
    assert.match(html, /mot…</, 'coupé sur une frontière de mot, avec ellipse');
    assert.match(html, /<summary>Voir les \d+ autres<\/summary>/);
  });
});
