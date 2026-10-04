import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { classifyCommand, classifyFileRead, classifyFileWrite } from '../src/domain/guardrails.js';
import { cli, json, rm, runtimeHook, sandbox } from './helpers.js';

const ctx = (allowedSecrets: string[] = []) => ({ autonomy: 'balanced' as const, protectedBranches: ['main'], allowedSecrets });

describe('secrets : utiliser sans voir, autoriser explicitement', () => {
  it('par défaut, lire un secret est interdit ; l\'utiliser via un programme ne l\'est pas', () => {
    assert.equal(classifyCommand('cat .env', ctx()).class, 'forbidden');
    assert.equal(classifyCommand('npm test', ctx()).class, 'autonomous');
    assert.equal(classifyCommand('node --env-file=.env app.js', ctx()).class, 'autonomous');
  });

  it('un fichier autorisé devient lisible et modifiable, les autres restent protégés', () => {
    const allowed = ['.env.development'];
    assert.equal(classifyCommand('cat .env.development', ctx(allowed)).class, 'autonomous');
    assert.equal(classifyCommand('cat .env', ctx(allowed)).class, 'forbidden');
    assert.equal(classifyFileRead('.env.development', allowed).class, 'autonomous');
    assert.equal(classifyFileRead('.env', allowed).class, 'forbidden');
    assert.equal(classifyFileWrite('.env.development', 'balanced', allowed).class, 'autonomous');
  });

  it('l\'agent ne peut pas s\'accorder lui-même un secret', () => {
    const v = classifyCommand('node .ceng/runtime/cli.js secrets allow .env', ctx());
    assert.equal(v.class, 'approval');
    assert.equal(v.rule, 'secrets-allow');
  });
});

const dirs: string[] = [];
after(() => dirs.forEach(rm));

describe('commande ceng secrets', () => {
  const dir = sandbox('web-shop');
  dirs.push(dir);
  assert.equal(cli(dir, ['init', '--yes']).code, 0);
  fs.writeFileSync(path.join(dir, '.env.development'), 'STRIPE_SECRET_KEY=sk_test_abc123\nDATABASE_URL=\n# commentaire\n');
  fs.writeFileSync(path.join(dir, '.env'), 'OTHER=1\n');
  const settings = () => JSON.parse(fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf8')) as { permissions: { deny: string[] }; hooks: { PreToolUse: { matcher?: string }[] } };

  it('keys : montre les noms des variables, jamais les valeurs', () => {
    const r = cli(dir, ['secrets', 'keys', '.env.development']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /STRIPE_SECRET_KEY : définie/);
    assert.match(r.stdout, /DATABASE_URL : vide/);
    assert.ok(!r.stdout.includes('sk_test_abc123'), 'aucune valeur affichée');
  });

  it('allow : retire la règle native qui bloquerait ce fichier, ajoute une garde de lecture pour les autres', () => {
    assert.ok(settings().permissions.deny.includes('Read(./.env.development)'));
    const r = cli(dir, ['secrets', 'allow', '.env.development']);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!settings().permissions.deny.includes('Read(./.env.development)'));
    assert.ok(settings().permissions.deny.includes('Read(./.env)'), 'les autres secrets restent bloqués nativement');
    assert.ok(settings().hooks.PreToolUse.some((g) => g.matcher === 'Read'));
    const okRead = runtimeHook(dir, 'guard-read', { tool_name: 'Read', tool_input: { file_path: path.join(dir, '.env.development') } });
    assert.equal(okRead.stdout, '');
    const denied = JSON.parse(runtimeHook(dir, 'guard-read', { tool_name: 'Read', tool_input: { file_path: path.join(dir, '.env') } }).stdout);
    assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
    assert.deepEqual(json<string[]>(cli(dir, ['secrets', 'list', '--json'])), ['.env.development']);
  });

  it('production : refusé sans confirmation explicite', () => {
    fs.writeFileSync(path.join(dir, '.env.production'), 'K=1\n');
    const r = cli(dir, ['secrets', 'allow', '.env.production']);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /PRODUCTION/);
  });

  it('revoke : tout redevient protégé', () => {
    assert.equal(cli(dir, ['secrets', 'revoke', '.env.development']).code, 0);
    assert.ok(settings().permissions.deny.includes('Read(./.env.development)'));
    assert.ok(!settings().hooks.PreToolUse.some((g) => g.matcher === 'Read'));
  });
});
