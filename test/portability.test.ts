import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { cli, rm, sandbox } from './helpers.js';

/**
 * Portabilité : un projet initialisé sur une machine A doit fonctionner sur une machine B à partir du seul dépôt
 * git — sans le framework installé globalement, sans mémoire ni skills personnelles (HOME vide).
 */
const dirs: string[] = [];
after(() => dirs.forEach(rm));

describe('portabilité : le dépôt suffit, rien ne dépend de la machine d\'origine', () => {
  const origin = sandbox('web-shop');
  dirs.push(origin);
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  assert.equal(cli(origin, ['init', '--yes']).code, 0);
  assert.equal(cli(origin, ['task', 'add', '--title', 'Webhook', '--complexity', '2', '--files', 'app/api/**', '--domains', 'payments']).code, 0);
  assert.equal(cli(origin, ['checkpoint', '--done', 'init', '--next', 'webhook']).code, 0);
  git(origin, 'add', '-A');
  git(origin, 'commit', '-q', '-m', 'chore: ceng');

  const machineB = fs.mkdtempSync(path.join(os.tmpdir(), 'ceng-machine-b-'));
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ceng-home-'));
  dirs.push(machineB, emptyHome);
  const clone = path.join(machineB, 'web-shop');
  // --no-local : comme un clone réseau (GitHub), seuls les objets atteignables depuis les branches sont copiés.
  git(machineB, 'clone', '-q', '--no-local', origin, clone);
  const env = { ...process.env, HOME: emptyHome, USERPROFILE: emptyHome, CLAUDE_PROJECT_DIR: clone, CENG_NO_CODE_GRAPH: '1' };
  const runtime = (args: string[], input = '') => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [path.join(clone, '.ceng/runtime', ...args.slice(0, 1)), ...args.slice(1)], { cwd: clone, env, encoding: 'utf8', input, stdio: 'pipe' }) };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };

  it('le clone contient runtime, hooks, agents, skills (dont ceng-setup) et consignes', () => {
    for (const f of ['.ceng/runtime/cli.js', '.ceng/runtime/hooks/run.js', '.ceng/config.json', '.ceng/brain/tasks.json', '.claude/settings.json', '.claude/agents/ceng-builder.md', '.claude/skills/ceng-orchestrate/SKILL.md', '.claude/skills/ceng-setup/SKILL.md']) {
      assert.ok(fs.existsSync(path.join(clone, f)), f);
    }
    const claudeMd = fs.readFileSync(path.join(clone, 'CLAUDE.md'), 'utf8');
    assert.match(claudeMd, /Nouvelle machine \/ clone/);
    assert.ok(!/C:\\Projets|Jean-Paul\\/.test(claudeMd), 'aucun chemin propre à la machine d\'origine');
  });

  it('la CLI vendored fonctionne sans installation (tâches et route)', () => {
    const r = runtime(['cli.js', 'route', 'T-0001']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Revue : critical/);
  });

  it('le hook de démarrage injecte le brief de reprise', () => {
    const r = runtime(['hooks/run.js', 'session-start'], JSON.stringify({ source: 'startup' }));
    const ctx = JSON.parse(r.out).hookSpecificOutput.additionalContext as string;
    assert.match(ctx, /\[ceng\] Framework d'ingénierie actif/);
    assert.match(ctx, /T-0001/);
  });

  it('les garde-fous sont actifs', () => {
    const r = runtime(['hooks/run.js', 'guard-command'], JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'cat .env' } }));
    assert.equal(JSON.parse(r.out).hookSpecificOutput.permissionDecision, 'deny');
  });

  it('un instantané créé sur l\'autre machine donne une erreur explicite, pas une erreur git obscure', () => {
    const r = runtime(['cli.js', 'rollback', 'CP-0001']);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /autre machine ou un autre clone/);
  });
});
