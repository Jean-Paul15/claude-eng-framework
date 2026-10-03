import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { classifyCommand, parseDeletion } from '../src/domain/guardrails.js';
import { cli, rm, runtimeHook, sandbox } from './helpers.js';

const ctx = { autonomy: 'balanced' as const, protectedBranches: ['main'] };

describe('suppressions : détection', () => {
  it('reconnaît rm, Remove-Item, del, rmdir, git rm', () => {
    assert.deepEqual(parseDeletion('rm -rf src/old'), { targets: ['src/old'], recursive: true });
    assert.deepEqual(parseDeletion('rm a.ts b.ts'), { targets: ['a.ts', 'b.ts'], recursive: false });
    assert.deepEqual(parseDeletion('Remove-Item -Recurse -Force src/old'), { targets: ['src/old'], recursive: true });
    assert.deepEqual(parseDeletion('git rm src/a.ts'), { targets: ['src/a.ts'], recursive: false });
    assert.equal(parseDeletion('rmdir /s build2')?.recursive, true);
    assert.equal(parseDeletion('npm test'), null);
  });
  it('régénérable : autonome ; autre suppression : « delete » levable ; mélange avec push forcé : approbation', () => {
    assert.equal(classifyCommand('rm -rf node_modules dist', ctx).class, 'autonomous');
    const v = classifyCommand('rm -rf src/old', ctx);
    assert.equal(v.rule, 'delete');
    assert.deepEqual(v.deletion?.targets, ['src/old']);
    assert.equal(classifyCommand('rm src/a.ts && git push --force', ctx).rule, 'git-force-push');
    assert.equal(classifyCommand('rm .env', ctx).rule, 'delete-secret');
  });
});

const dirs: string[] = [];
after(() => dirs.forEach(rm));

describe('suppressions : récupérables donc sans frein', () => {
  const dir = sandbox('api-backend');
  dirs.push(dir);
  assert.equal(cli(dir, ['init', '--yes']).code, 0);
  fs.appendFileSync(path.join(dir, '.gitignore'), '\n.env\n');
  const guard = (command: string) => {
    const r = runtimeHook(dir, 'guard-command', { tool_name: 'Bash', cwd: dir, tool_input: { command } });
    return r.stdout ? (JSON.parse(r.stdout) as { hookSpecificOutput: { permissionDecision?: string; additionalContext?: string; permissionDecisionReason?: string } }).hookSpecificOutput : undefined;
  };

  it('un dossier créé par Claude est supprimé sans demander, et la suppression est annulable', () => {
    fs.mkdirSync(path.join(dir, 'app/draft'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'app/draft/idea.py'), 'x = 1\n');
    const out = guard('rm -rf app/draft');
    assert.equal(out?.permissionDecision, 'allow');
    const cp = out?.additionalContext?.match(/CP-\d{4}/)?.[0];
    assert.ok(cp, 'instantané référencé');
    fs.rmSync(path.join(dir, 'app/draft'), { recursive: true });
    assert.equal(cli(dir, ['rollback', cp!, '--apply']).code, 0);
    assert.ok(fs.existsSync(path.join(dir, 'app/draft/idea.py')), 'fichier restauré par rollback');
  });

  it('un simple fichier aussi', () => {
    fs.writeFileSync(path.join(dir, 'app/tmp_notes.py'), 'pass\n');
    assert.equal(guard('rm app/tmp_notes.py')?.permissionDecision, 'allow');
  });

  it('demande l\'humain quand rien ne peut être sauvegardé', () => {
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config/.env'), 'SECRET=1\n');
    fs.writeFileSync(path.join(dir, 'config/app.toml'), 'a = 1\n');
    const ignored = guard('rm -rf config');
    assert.equal(ignored?.permissionDecision, 'deny');
    assert.match(ignored?.permissionDecisionReason ?? '', /AskUserQuestion/);
    assert.match(ignored?.permissionDecisionReason ?? '', /ignorés par git/);
    for (const c of ['rm -rf ../autre-projet', 'rm -rf .ceng/brain', 'rm -rf app/*']) {
      const o = guard(c);
      assert.equal(o?.permissionDecision, 'deny', c);
      assert.match(o?.permissionDecisionReason ?? '', /Approuver R-\d{4}/, c);
    }
  });

  it('commande mixte : instantané pris mais pas d\'« allow » global (les autres segments suivent les permissions normales)', () => {
    fs.writeFileSync(path.join(dir, 'app/scratch.py'), 'pass\n');
    const out = guard('rm app/scratch.py && pytest -q');
    assert.equal(out?.permissionDecision, undefined);
    assert.match(out?.additionalContext ?? '', /Suppression autorisée/);
  });
});
