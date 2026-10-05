import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { cli, json, rm, runtimeHook, sandbox } from './helpers.js';
import type { RouteDecision, Task } from '../src/domain/types.js';

/**
 * Scénario de bout en bout sur l'API de démo, joué comme le feraient l'orchestrateur, les workers
 * et les hooks Claude Code : bootstrap → tâches → routage → gates → échecs → escalade → checkpoint
 * → interruption → reprise → rollback → observabilité.
 */
// Faux identifiant construit à l'exécution (pas de motif de secret littéral dans le dépôt).
const FAKE_AWS = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
let dir = '';
before(() => {
  dir = sandbox('api-backend');
  // Commandes de gate déterministes pour le test (le projet de démo n'a pas Python installé).
  assert.equal(cli(dir, ['init', '--yes', '--goal', 'API de gestion des utilisateurs']).code, 0);
  const cfgPath = path.join(dir, '.ceng/config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.commands = { build: 'node -e "process.exit(0)"', typecheck: 'node -e "process.exit(0)"', lint: 'node -e "process.exit(0)"', unit: 'node -e "process.exit(0)"', integration: 'node -e "process.exit(0)"' };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
});
after(() => rm(dir));

const run = (...args: string[]) => cli(dir, args);

describe('cycle de vie complet', () => {
  it('refuse une tâche non triviale sans critère d\'acceptation', () => {
    const r = run('task', 'add', '--title', 'Pagination', '--complexity', '3');
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /critère d'acceptation/);
  });

  it('crée un graphe de tâches avec dépendances et refuse les cycles', () => {
    assert.equal(run('task', 'add', '--title', 'Modèle User', '--kind', 'feature', '--complexity', '2', '--risk', '2', '--files', 'app/users/**', '--accept', 'CRUD testé').code, 0);
    assert.equal(run('task', 'add', '--title', 'Login JWT', '--kind', 'security', '--complexity', '2', '--risk', '4', '--domains', 'auth', '--files', 'app/auth/**', '--deps', 'T-0001', '--accept', 'jeton expiré refusé', '--accept', 'mot de passe haché argon2').code, 0);
    assert.equal(run('task', 'add', '--title', 'Docs API', '--kind', 'docs', '--complexity', '1', '--risk', '1', '--context', 'S', '--files', 'docs/**').code, 0);
    assert.notEqual(run('task', 'add', '--title', 'X', '--deps', 'T-0099').code, 0);
    const ready = json<Task[]>(run('task', 'next', '--json'));
    assert.deepEqual(ready.map((t) => t.id).sort(), ['T-0001', 'T-0003']);
  });

  it('route une tâche sensible avec threat model, revue sécurité et explication', () => {
    const r = json<RouteDecision>(run('route', 'T-0002', '--json'));
    assert.ok(r.phases.some((p) => p.step === 'threat-model'));
    assert.ok(r.gates.some((g) => g.gate === 'security-review' && g.required));
    assert.ok(r.reasons.length >= 3);
  });

  it('plan : tâche triviale en direct, le reste séquentiel/parallèle sans recouvrement', () => {
    const plan = json<{ batches: { mode: string; tasks: string[] }[] }>(run('plan', '--json'));
    assert.ok(plan.batches.some((b) => b.mode === 'direct' && b.tasks.includes('T-0003')));
    assert.ok(plan.batches.some((b) => b.tasks.includes('T-0001')));
  });

  it('hooks : la délégation est tracée et liée à la tâche (agent ↔ tâche)', () => {
    assert.equal(run('task', 'start', 'T-0001').code, 0);
    runtimeHook(dir, 'agent-spawn', { session_id: 's1', tool_name: 'Agent', tool_input: { subagent_type: 'ceng-builder', model: 'sonnet', description: 'T-0001 Modèle User', prompt: 'Tâche T-0001 — Modèle User' } });
    runtimeHook(dir, 'subagent-start', { session_id: 's1', agent_id: 'agent-a', agent_type: 'ceng-builder' });
    const edited = runtimeHook(dir, 'file-edited', { session_id: 's1', agent_id: 'agent-a', agent_type: 'ceng-builder', tool_name: 'Write', tool_input: { file_path: path.join(dir, 'app/users/model.py') } });
    assert.equal(edited.code, 0);
    const log = run('log', '--task', 'T-0001', '--json');
    const events = json<{ type: string; agentType?: string; model?: string }[]>(log);
    assert.ok(events.some((e) => e.type === 'agent.spawn' && e.agentType === 'ceng-builder' && e.model === 'sonnet'));
    assert.ok(events.some((e) => e.type === 'file.edited'));
  });

  it('hooks : un worker ne peut pas éditer un fichier possédé par une autre tâche en cours', () => {
    assert.equal(run('task', 'unblock', 'T-0003').code, 0);
    assert.equal(run('task', 'start', 'T-0003').code, 0);
    const edit = () => runtimeHook(dir, 'guard-file', { agent_id: 'agent-a', agent_type: 'ceng-builder', tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'docs/api.md') } });
    // T-0003 « en cours » mais sans agent vivant : ses fichiers ne sont pas verrouillés.
    assert.equal(edit().stdout, '');
    // Un sous-agent travaille réellement sur T-0003 : le fichier est protégé.
    runtimeHook(dir, 'agent-spawn', { session_id: 's1', tool_name: 'Agent', tool_input: { subagent_type: 'ceng-builder', model: 'sonnet', description: 'T-0003 Doc API', prompt: 'Tâche T-0003 — Doc API' } });
    const out = JSON.parse(edit().stdout) as { hookSpecificOutput: { permissionDecision: string } };
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  });

  it('hooks : rapport obligatoire en fin de subagent (une seule fois, sans boucle)', () => {
    const blocked = runtimeHook(dir, 'subagent-stop', { agent_id: 'agent-a', agent_type: 'ceng-builder', last_assistant_message: 'fini', stop_hook_active: false });
    assert.equal(JSON.parse(blocked.stdout).decision, 'block');
    const loopGuard = runtimeHook(dir, 'subagent-stop', { agent_id: 'agent-a', agent_type: 'ceng-builder', last_assistant_message: 'fini', stop_hook_active: true });
    assert.equal(loopGuard.stdout, '');
    const ok = runtimeHook(dir, 'subagent-stop', { agent_id: 'agent-a', agent_type: 'ceng-builder', last_assistant_message: 'CENG_REPORT\nstatus: done' });
    assert.equal(ok.stdout, '');
  });

  it('gates : « done » refusé tant que les gates requises ne sont pas vertes', () => {
    const refused = run('task', 'done', 'T-0001', '--evidence', 'tests verts');
    assert.notEqual(refused.code, 0);
    assert.match(refused.stderr, /gates requises manquantes/);
    fs.mkdirSync(path.join(dir, '.ceng/brain/reports'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.ceng/brain/reports/T-0001.md'), '# T-0001\nfait');
    const gates = run('gate', 'run', 'T-0001');
    assert.match(gates.stdout, /build/);
    assert.match(gates.stdout, /secrets/);
    assert.equal(run('gate', 'record', 'T-0001', 'review', 'pass', '--note', 'ceng-reviewer : aucun bloquant').code, 0);
    const done = run('task', 'done', 'T-0001', '--evidence', 'gates vertes, commit abc');
    assert.equal(done.code, 0, done.stderr);
  });

  it('une tâche jamais routée ne peut pas contourner les gates', () => {
    assert.equal(run('task', 'add', '--title', 'Refactor du service', '--kind', 'refactor', '--complexity', '2', '--files', 'app/core/**').code, 0);
    const r = run('task', 'done', 'T-0004', '--evidence', 'rien');
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /gates requises manquantes/);
    assert.equal(run('task', 'cancel', 'T-0004', '--reason', 'test').code, 0);
  });

  it('gate secrets : détecte un secret introduit', () => {
    fs.writeFileSync(path.join(dir, 'app/auth/config.py'), `KEY = "${FAKE_AWS}"\n`);
    assert.equal(run('task', 'start', 'T-0002').code, 0);
    const r = run('gate', 'run', 'T-0002', '--only', 'secrets');
    assert.notEqual(r.code, 0);
    assert.match(r.stdout, /aws-access-key/);
    fs.rmSync(path.join(dir, 'app/auth/config.py'));
  });

  it('garde-fou : commande dangereuse refusée, destructive soumise à l\'humain', () => {
    const deny = JSON.parse(runtimeHook(dir, 'guard-command', { tool_name: 'Bash', tool_input: { command: 'cat .env' } }).stdout);
    assert.equal(deny.hookSpecificOutput.permissionDecision, 'deny');
    const ask = JSON.parse(runtimeHook(dir, 'guard-command', { tool_name: 'Bash', tool_input: { command: 'git reset --hard HEAD~3' } }).stdout);
    assert.equal(ask.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(ask.hookSpecificOutput.permissionDecisionReason, /AskUserQuestion/);
    assert.equal(runtimeHook(dir, 'guard-command', { tool_name: 'Bash', tool_input: { command: 'pytest -q' } }).stdout, '');
  });

  it('échecs → nouvelle stratégie → ESCALATE_TO_OPUS', () => {
    const f1 = json<Task>(run('task', 'fail', 'T-0002', '--reason', 'expiration du jeton non vérifiée', '--json'));
    assert.equal(f1.route?.escalate.required, false);
    assert.equal(run('task', 'start', 'T-0002', '--strategy', 'utiliser la validation de la lib').code, 0);
    const f2 = json<Task>(run('task', 'fail', 'T-0002', '--reason', 'horloge non injectable dans les tests', '--json'));
    assert.equal(f2.route?.escalate.required, true);
    assert.equal(f2.route?.implementer.model, 'opus');
    const esc = run('escalate', 'T-0002', '--problem', 'Tests d\'expiration non déterministes', '--tried', 'freezegun ; injection', '--decision', 'Comment injecter l\'horloge ?');
    assert.match(esc.stdout, /ESCALATE_TO_OPUS/);
    const file = fs.readdirSync(path.join(dir, '.ceng/brain/escalations')).find((f) => f.startsWith('E-0001'))!;
    assert.match(fs.readFileSync(path.join(dir, '.ceng/brain/escalations', file), 'utf8'), /Décision attendue/);
    assert.equal(run('escalate', 'resolve', 'E-0001', '--decision', 'Injecter un Clock en paramètre').code, 0);
  });

  it('checkpoint, interruption (rate limit) et reprise sans historique', () => {
    fs.writeFileSync(path.join(dir, 'app/auth/clock.py'), 'class Clock: ...\n');
    const cp = json<{ id: string; snapshot?: string }>(run('checkpoint', '--task', 'T-0002', '--done', 'Clock injectable ajouté', '--next', 'écrire le test d\'expiration', '--json'));
    assert.ok(cp.snapshot, 'instantané git créé');
    runtimeHook(dir, 'stop-failure', { error_type: 'rate_limit' });
    const start = runtimeHook(dir, 'session-start', { source: 'resume', session_id: 's2' });
    const ctx = JSON.parse(start.stdout).hookSpecificOutput.additionalContext as string;
    assert.match(ctx, /interrompue \(rate_limit\)/);
    assert.match(ctx, /T-0002/);
    assert.match(ctx, /écrire le test d'expiration/);
  });

  it('PreCompact : checkpoint automatique ; Stop : rappel unique de checkpoint', () => {
    assert.equal(runtimeHook(dir, 'pre-compact', { trigger: 'auto' }).code, 0);
    const cps = json<{ auto: boolean }[]>(run('checkpoint', 'list', '--json'));
    assert.ok(cps.some((c) => c.auto));
    runtimeHook(dir, 'file-edited', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'app/auth/routes.py') } });
    const first = runtimeHook(dir, 'stop', {});
    assert.equal(JSON.parse(first.stdout).decision, 'block');
    assert.equal(runtimeHook(dir, 'stop', {}).stdout, '', 'pas de boucle');
  });

  it('rollback non destructif : sauvegarde l\'état courant puis restaure', () => {
    const cps = json<{ id: string; snapshot?: string; done: string }[]>(run('checkpoint', 'list', '--json'));
    const target = cps.find((c) => c.done === 'Clock injectable ajouté')!;
    fs.writeFileSync(path.join(dir, 'app/auth/clock.py'), 'BROKEN\n');
    const preview = run('rollback', target.id);
    assert.match(preview.stdout, /--apply/);
    assert.equal(fs.readFileSync(path.join(dir, 'app/auth/clock.py'), 'utf8'), 'BROKEN\n', 'aperçu sans effet');
    const applied = run('rollback', target.id, '--apply');
    assert.equal(applied.code, 0, applied.stderr);
    // core.autocrlf (Windows) peut convertir les fins de ligne à la restauration : on compare le contenu.
    assert.equal(fs.readFileSync(path.join(dir, 'app/auth/clock.py'), 'utf8').replace(/\r\n/g, '\n'), 'class Clock: ...\n');
    assert.match(applied.stdout, /annulable/);
  });

  it('observabilité : rapport par tâche (modèles, tentatives, escalade, pourquoi terminé)', () => {
    const rep = json<{ byModel: Record<string, number>; tasks: { id: string; attempts: number; escalated: boolean; doneBecause: string }[] }>(run('report', '--json'));
    assert.ok((rep.byModel['sonnet'] ?? 0) >= 1);
    const t2 = rep.tasks.find((t) => t.id === 'T-0002')!;
    assert.ok(t2.escalated);
    assert.ok(t2.attempts >= 2);
    assert.match(rep.tasks.find((t) => t.id === 'T-0001')!.doneBecause, /gates vertes/);
    const raw = fs.readFileSync(path.join(dir, '.ceng/logs/events.jsonl'), 'utf8');
    assert.ok(!raw.includes(FAKE_AWS), 'aucun secret dans les journaux');
  });

  it('auto-amélioration : une leçon isolée n\'est pas promue, une leçon répétée l\'est', () => {
    run('learn', 'add', '--topic', 'Horloge injectable', '--lesson', 'Injecter Clock pour tester l\'expiration', '--task', 'T-0002', '--kind', 'procedure', '--skill', 'testing');
    assert.match(run('learn', 'promote').stdout, /Aucune leçon/);
    run('learn', 'add', '--topic', 'horloge-injectable', '--lesson', 'idem', '--task', 'T-0005');
    run('learn', 'add', '--topic', 'horloge injectable', '--lesson', 'idem', '--task', 'T-0006');
    const c = json<{ topic: string; distinctTasks: number; targetSkill?: string }[]>(run('learn', 'promote', '--json'));
    assert.equal(c[0]?.topic, 'horloge-injectable');
    assert.equal(c[0]?.distinctTasks, 3);
    assert.equal(c[0]?.targetSkill, 'testing');
  });

  it('adaptation : aucun ajustement sur un échantillon insuffisant', () => {
    const r = json<{ overrides: { reasons: string[] } }>(run('adapt', '--json'));
    assert.equal(r.overrides.reasons.length, 0);
  });

  it('INDEX.md reste compact (progressive disclosure)', () => {
    run('status');
    const index = fs.readFileSync(path.join(dir, '.ceng/brain/INDEX.md'), 'utf8');
    assert.ok(index.split('\n').length < 70, `${index.split('\n').length} lignes`);
    assert.match(index, /Où trouver le reste/);
  });
});
