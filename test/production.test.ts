import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { runDbSecurityGate } from '../src/app/data-map.js';
import { BrainStore } from '../src/brain/store.js';
import { cli, rm, runtimeHook, sandbox } from './helpers.js';

let dir = '';
const run = (...a: string[]) => cli(dir, a);
const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};

before(() => {
  dir = sandbox('api-backend');
  assert.equal(cli(dir, ['init', '--yes']).code, 0);
});
after(() => rm(dir));

describe('sécurité de la base Supabase prouvée par des tests (S-02)', () => {
  it('sans Supabase ou sans migration : sans objet', () => {
    const store = new BrainStore(dir);
    assert.equal(runDbSecurityGate(store, []).status, 'pass');
    write('supabase/config.toml', 'project_id = "x"\n');
    assert.match(runDbSecurityGate(store, ['app/x.py']).detail, /Aucune migration/);
  });
  it('une table sans test d\'accès fait échouer, avec test elle passe', () => {
    const store = new BrainStore(dir);
    write('supabase/migrations/0001_notes.sql', 'create table notes (id uuid primary key, body text);');
    const r = runDbSecurityGate(store, ['supabase/migrations/0001_notes.sql']);
    assert.equal(r.status, 'fail');
    assert.match(r.detail, /notes/);
    write('supabase/tests/notes.sql', "select policies_are('public', 'notes', array['own rows']);");
    assert.equal(runDbSecurityGate(store, ['supabase/migrations/0001_notes.sql']).status, 'pass');
  });
});

describe('vérification après déploiement (S-05)', () => {
  it('un déploiement abouti déclenche le rappel ; une commande ordinaire non', () => {
    const done = (command: string) => runtimeHook(dir, 'command-done', { tool_name: 'Bash', tool_input: { command } });
    assert.match(done('supabase functions deploy hello').stdout, /ceng verify|verify/);
    assert.equal(done('ls -la').stdout, '');
  });
  it('ceng verify : sans commande smoke, échec expliqué ; avec, selon le code de sortie', () => {
    assert.equal(run('verify').code, 1);
    const cfgPath = path.join(dir, '.ceng/config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.commands.smoke = 'node -e "process.exit(0)"';
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    assert.equal(run('verify').code, 0);
    cfg.commands.smoke = 'node -e "process.exit(3)"';
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    const r = run('verify');
    assert.equal(r.code, 1);
    assert.match(r.stdout, /ÉCHEC/);
  });
});
