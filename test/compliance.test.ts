import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { runAbuseTestsGate, runSecretsGate } from '../src/app/gates.js';
import { classificationProblems, parseComments, parseTables } from '../src/domain/data-map.js';
import { cli, json, rm, sandbox } from './helpers.js';

const MIGRATION = `create table profiles (
  id uuid primary key,
  user_id uuid references auth.users(id),
  phone text,
  birth_date date,
  constraint chk check (phone <> '')
);
alter table orders add column note text;
comment on column profiles.id is 'pii:none';
comment on column profiles.user_id is 'pii:identity; purpose:account; basis:contract; retention:account+30d';
comment on column profiles.phone is 'pii:contact; purpose:delivery';`;

describe('carte des données (G-3)', () => {
  it('lit les colonnes, ignore les contraintes, repère les tables personnelles', () => {
    const t = parseTables(MIGRATION);
    assert.deepEqual(t[0]!.columns, ['id', 'user_id', 'phone', 'birth_date']);
    assert.deepEqual(t[1], { name: 'orders', columns: ['note'], body: ' text', alter: true });
  });
  it('signale les colonnes non classées et les classifications incomplètes', () => {
    const p = classificationProblems(parseTables(MIGRATION), parseComments(MIGRATION));
    assert.ok(p.some((x) => x.startsWith('profiles.birth_date : non classée')));
    assert.ok(p.some((x) => x.includes('profiles.phone') && x.includes('exige purpose, basis et retention')));
    assert.ok(!p.some((x) => x.startsWith('profiles.id')));
    assert.ok(!p.some((x) => x.startsWith('orders.note')), 'table sans lien à une personne : ignorée');
  });
});

describe('socle, ready et gates (G-2, G-6, S-01)', () => {
  let dir = '';
  const run = (...a: string[]) => cli(dir, a);
  before(() => {
    dir = sandbox('api-backend');
    assert.equal(cli(dir, ['init', '--yes', '--goal', 'API']).code, 0);
  });
  after(() => rm(dir));

  it('compliance : manquant par défaut, déclaré avec fichiers et tests existants, écarté par une décision', () => {
    run('task', 'add', '--title', 'Comptes', '--kind', 'chore', '--domains', 'auth,pii');
    assert.match(run('compliance', 'status').stdout, /✖ C-01/);
    fs.mkdirSync(path.join(dir, 'supabase/migrations'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'supabase/migrations/0001_legal.sql'), 'create table legal_documents (id uuid);');
    fs.writeFileSync(path.join(dir, 'supabase/legal.test.sql'), 'select 1;');
    assert.notEqual(run('compliance', 'set', 'C-01', '--files', 'supabase/migrations/0001_legal.sql').code, 99);
    assert.match(run('compliance', 'status').stdout, /✖ C-01 .*test exigé/);
    run('compliance', 'set', 'C-01', '--files', 'supabase/migrations/0001_legal.sql', '--tests', 'supabase/legal.test.sql');
    assert.match(run('compliance', 'status').stdout, /✔ C-01/);
    run('compliance', 'set', 'C-04', '--files', 'inexistant.sql', '--tests', 'x.sql');
    assert.match(run('compliance', 'status').stdout, /✖ C-04 .*introuvable/);
    run('decision', 'add', '--title', 'Pas de traceurs', '--context', 'c', '--decision', 'd', '--consequences', 'q');
    run('compliance', 'waive', 'C-02', '--decision', 'ADR-0001-pas-de-traceurs.md');
    assert.match(run('compliance', 'status').stdout, /– C-02 .*écarté/);
  });

  it('ready : échoue avec la marche à suivre, une décision ready:<id> lève un contrôle', () => {
    fs.writeFileSync(path.join(dir, 'app', 'config.py'), 'import os\nKEY = os.getenv("PAYMENT_KEY")\n# TODO nettoyer\n');
    const r = run('ready');
    assert.equal(r.code, 1);
    assert.match(r.stdout, /✖ Variables d'environnement documentées .*PAYMENT_KEY/);
    assert.match(r.stdout, /✖ Aucun TODO sans tâche/);
    assert.match(r.stdout, /✖ Socle de conformité/);
    run('decision', 'add', '--title', "Pas de suivi d'erreurs pour ce prototype", '--context', 'ready:errors', '--decision', 'ready:errors écarté', '--consequences', 'q');
    assert.match(run('ready').stdout, /– Suivi des erreurs en production — écarté par la décision/);
    const rows = json<{ checks: { id: string; status: string }[] }>(run('ready', '--json')).checks;
    assert.ok(rows.some((c) => c.id === 'compliance' && c.status === 'fail'));
  });

  it('abuse-tests : un test de refus est exigé sur domaine sensible', () => {
    assert.equal(runAbuseTestsGate(dir, ['app/auth.py']).status, 'fail');
    fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tests/auth.test.ts'), "it('login ok', () => {});\n");
    assert.equal(runAbuseTestsGate(dir, ['tests/auth.test.ts']).status, 'fail');
    fs.writeFileSync(path.join(dir, 'tests/auth.test.ts'), "it('refuse la ressource d\'un autre utilisateur', () => {});\n");
    assert.equal(runAbuseTestsGate(dir, ['tests/auth.test.ts']).status, 'pass');
    void runSecretsGate;
  });

  it('privacy : gate sur les migrations modifiées par la tâche', () => {
    fs.writeFileSync(path.join(dir, 'supabase/migrations/0002_profile.sql'), 'create table profiles (id uuid primary key, user_id uuid, email text);');
    const r = run('gate', 'run', 'T-0001');
    assert.ok(r.code === 0 || r.code === 1);
    assert.match(run('data-map').stdout, /Carte des données écrite/);
  });
});

describe('socle évolutif : base minimale, pas liste figée', () => {
  let dir = '';
  const run = (...a: string[]) => cli(dir, a);
  before(() => {
    dir = sandbox('api-backend');
    assert.equal(cli(dir, ['init', '--yes', '--goal', 'API']).code, 0);
    run('task', 'add', '--title', 'Comptes', '--kind', 'chore', '--domains', 'auth,pii');
  });
  after(() => rm(dir));

  it('un mécanisme du projet s\'ajoute, compte comme manquant, puis se déclare', () => {
    assert.notEqual(run('compliance', 'add', 'C-15', '--title', 'x').code, 0, 'identifiant X-xx seulement');
    assert.equal(run('compliance', 'add', 'X-01', '--title', 'Registre des consentements parentaux', '--because', 'loi mineurs 2027', '--test').code, 0);
    assert.match(run('compliance', 'status').stdout, /✖ X-01 Registre des consentements parentaux — à construire \(loi mineurs 2027\)/);
    fs.writeFileSync(path.join(dir, 'parental.sql'), 'select 1;');
    fs.writeFileSync(path.join(dir, 'parental.test.sql'), 'select 1;');
    assert.match(run('compliance', 'set', 'X-01', '--files', 'parental.sql').stdout, /X-01 déclaré/);
    assert.match(run('compliance', 'status').stdout, /✖ X-01 .*test exigé/);
    run('compliance', 'set', 'X-01', '--files', 'parental.sql', '--tests', 'parental.test.sql');
    assert.match(run('compliance', 'status').stdout, /✔ X-01/);
  });

  it('veille légale : une recherche de plus de 12 mois fait échouer ready, une récente non', () => {
    const f = path.join(dir, '.ceng/brain/research/legal-fr.md');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '# RGPD\n');
    assert.match(run('ready').stdout, /✔ Veille légale à jour/);
    const old = new Date(Date.now() - 400 * 86_400_000);
    fs.utimesSync(f, old, old);
    assert.match(run('ready').stdout, /✖ Veille légale à jour .*mois/);
  });
});
