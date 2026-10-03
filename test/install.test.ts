import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { cli, json, rm, sandbox } from './helpers.js';

const dirs: string[] = [];
after(() => dirs.forEach(rm));
const read = (d: string, f: string) => fs.readFileSync(path.join(d, f), 'utf8');

describe('ceng init : bootstrap automatique', () => {
  it('installe le framework sans toucher au code du projet', () => {
    const dir = sandbox('web-shop');
    dirs.push(dir);
    const before = fs.readFileSync(path.join(dir, 'app/checkout/page.tsx'), 'utf8');
    const r = cli(dir, ['init', '--yes', '--json', '--budget', 'economy']);
    assert.equal(r.code, 0, r.stderr);
    const report = json<{ config: { policy: { criticalDomains: string[]; notes: string[]; orchestratorModel: string } }; skills: { installed: string[]; generated: string[] } }>(r);
    assert.deepEqual(report.config.policy.criticalDomains.includes('payments'), true);
    assert.ok(report.config.policy.notes.some((n) => n.includes('économique est conservée')));
    assert.ok(report.skills.generated.includes('stripe-engineering'));
    assert.ok(report.skills.generated.includes('postgres-engineering'));
    for (const f of ['.ceng/config.json', '.ceng/profile.json', '.ceng/brain/INDEX.md', '.ceng/brain/project.md', '.ceng/brain/tasks.json', '.ceng/runtime/cli.js', '.ceng/runtime/hooks/run.js', '.ceng/runtime/package.json', '.claude/settings.json', '.claude/agents/ceng-builder.md', '.claude/skills/ceng-orchestrate/SKILL.md', '.claude/skills/stripe-engineering/SKILL.md', 'CLAUDE.md']) {
      assert.ok(fs.existsSync(path.join(dir, f)), f);
    }
    assert.equal(fs.readFileSync(path.join(dir, 'app/checkout/page.tsx'), 'utf8'), before);
    const settings = JSON.parse(read(dir, '.claude/settings.json')) as { hooks: Record<string, unknown>; permissions: { deny: string[] } };
    for (const e of ['SessionStart', 'PreToolUse', 'PostToolUse', 'SubagentStop', 'PreCompact', 'Stop', 'StopFailure']) assert.ok(settings.hooks[e], e);
    assert.ok(settings.permissions.deny.includes('Read(./.env)'));
    assert.ok(read(dir, 'CLAUDE.md').includes('ceng:begin'));
    assert.ok(read(dir, '.gitignore').includes('.ceng/logs/'));
  });

  it('runtime autonome : la CLI vendored fonctionne sans le framework global', () => {
    const dir = dirs[0]!;
    const out = fs.readFileSync(path.join(dir, '.ceng/brain/INDEX.md'), 'utf8');
    assert.match(out, /Project Brain/);
    const status = execFileSync(process.execPath, [path.join(dir, '.ceng/runtime/cli.js'), 'status'], { cwd: dir, encoding: 'utf8' });
    assert.match(status, /Project Brain/);
  });

  it('fusion non destructive : préserve settings, hooks et CLAUDE.md de l\'utilisateur, idempotente', () => {
    const dir = sandbox('api-backend');
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude/settings.json'), JSON.stringify({ model: 'sonnet', permissions: { allow: ['Bash(make *)'] }, hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo user-hook' }] }] } }));
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Règles maison\n\nNe jamais utiliser ORM X.\n');
    assert.equal(cli(dir, ['init', '--yes']).code, 0);
    const first = read(dir, '.claude/settings.json');
    const s = JSON.parse(first) as { model: string; permissions: { allow: string[] }; hooks: { PostToolUse: { hooks: { command: string }[] }[] } };
    assert.equal(s.model, 'sonnet');
    assert.ok(s.permissions.allow.includes('Bash(make *)'));
    assert.ok(JSON.stringify(s.hooks.PostToolUse).includes('echo user-hook'));
    assert.ok(read(dir, 'CLAUDE.md').startsWith('# Règles maison'));
    assert.ok(fs.readdirSync(path.join(dir, '.ceng/backups')).length >= 1, 'sauvegarde avant modification');
    // Idempotence
    assert.equal(cli(dir, ['upgrade']).code, 0);
    assert.equal(read(dir, '.claude/settings.json'), first);
    assert.equal(read(dir, 'CLAUDE.md').split('ceng:begin').length, 2, 'un seul bloc ceng');
    assert.equal(read(dir, '.gitignore').split('.ceng/logs/').length, 2, 'gitignore sans doublon');
    assert.ok(read(dir, '.gitignore').includes('graphify-out/'));
  });

  it('préserve une skill modifiée par l\'utilisateur lors d\'un upgrade', () => {
    const dir = dirs[1]!;
    const skill = path.join(dir, '.claude/skills/testing/SKILL.md');
    fs.appendFileSync(skill, '\nRègle locale de l\'équipe.\n');
    const r = cli(dir, ['upgrade', '--json']);
    assert.equal(r.code, 0);
    assert.ok(read(dir, '.claude/skills/testing/SKILL.md').includes('Règle locale'));
    const actions = json<{ actions: { kind: string; path: string }[] }>(r).actions;
    assert.ok(actions.some((a) => a.kind === 'keep-user-version' && a.path === '.claude/skills/testing/SKILL.md'));
  });

  it('dry-run : aucune écriture', () => {
    const dir = sandbox('ts-library');
    dirs.push(dir);
    const r = cli(dir, ['init', '--yes', '--dry-run']);
    assert.equal(r.code, 0);
    assert.ok(!fs.existsSync(path.join(dir, '.ceng')));
    assert.ok(!fs.existsSync(path.join(dir, '.claude')));
  });

  it('doctor valide une installation saine ; uninstall retire proprement', () => {
    const dir = sandbox('mobile-app');
    dirs.push(dir);
    assert.equal(cli(dir, ['init', '--yes', '--parallelism', 'teams']).code, 0);
    const settings = JSON.parse(read(dir, '.claude/settings.json')) as { env?: Record<string, string> };
    assert.equal(settings.env?.['CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'], '1');
    const doc = json<{ name: string; ok: boolean }[]>(cli(dir, ['doctor', '--json']));
    // claude, graphify et la version dépendent de la machine (outils externes), pas de l'installation.
    for (const c of doc.filter((x) => !['claude', 'graphify', 'version'].includes(x.name))) assert.ok(c.ok, `${c.name}`);
    assert.equal(cli(dir, ['uninstall', '--yes']).code, 0);
    assert.ok(!read(dir, 'CLAUDE.md').includes('ceng:begin'));
    assert.ok(!read(dir, '.claude/settings.json').includes('.ceng/runtime'));
    assert.ok(!fs.existsSync(path.join(dir, '.claude/agents/ceng-builder.md')));
    assert.ok(fs.existsSync(path.join(dir, '.ceng/brain')), 'Brain conservé');
  });
});
