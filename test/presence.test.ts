import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { cli, rm, runtimeHook, sandbox } from './helpers.js';

/**
 * Validations par l'invite de questions et bascule automatique :
 * l'humain approuve via l'invite ; si l'invite expire sans réponse, plus rien n'attend et tout est consigné.
 */
const dirs: string[] = [];
after(() => dirs.forEach(rm));

type Out = { decision?: string; reason?: string; hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string; decision?: { behavior: string; message?: string } } };

describe('invite de questions et bascule automatique en mode sans humain', () => {
  const dir = sandbox('api-backend');
  dirs.push(dir);
  assert.equal(cli(dir, ['init', '--yes']).code, 0);
  const hook = (event: string, payload: Record<string, unknown>): Out => {
    const r = runtimeHook(dir, event, { session_id: 's1', ...payload });
    return r.stdout ? (JSON.parse(r.stdout) as Out) : {};
  };
  const forcePush = { tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } };
  const pending = () => (fs.existsSync(path.join(dir, '.ceng/brain/pending-approvals.md')) ? fs.readFileSync(path.join(dir, '.ceng/brain/pending-approvals.md'), 'utf8') : '');

  it('présent : une action sensible est soumise via l\'invite avec un identifiant (pas de boîte qui n\'expire jamais)', () => {
    hook('user-prompt', { prompt: '/ceng-orchestrate go' });
    const out = hook('guard-command', forcePush).hookSpecificOutput!;
    assert.equal(out.permissionDecision, 'deny');
    assert.match(out.permissionDecisionReason!, /AskUserQuestion/);
    assert.match(out.permissionDecisionReason!, /Approuver R-0001/);
    // Même action redemandée : même identifiant (pas de doublon).
    assert.match(hook('guard-command', forcePush).hookSpecificOutput!.permissionDecisionReason!, /R-0001/);
  });

  it('seule la vraie réponse de l\'humain autorise, une seule fois', () => {
    hook('question-answered', { tool_name: 'AskUserQuestion', tool_response: { answers: { 'Pousser en force ?': 'Approuver R-0001' } } });
    assert.equal(hook('guard-command', forcePush).hookSpecificOutput!.permissionDecision, 'allow');
    // Usage unique : la fois suivante, nouvelle demande.
    assert.match(hook('guard-command', forcePush).hookSpecificOutput!.permissionDecisionReason!, /Approuver R-\d{4}/);
  });

  it('les boîtes de permission natives passent aussi par l\'invite', () => {
    const npmInstall = { tool_name: 'Bash', tool_input: { command: 'npm install left-pad' } };
    const out = hook('permission-request', npmInstall).hookSpecificOutput!.decision!;
    assert.equal(out.behavior, 'deny');
    const id = out.message!.match(/R-\d{4}/)![0];
    hook('question-answered', { tool_response: `User selected: Approuver ${id}` });
    assert.equal(hook('permission-request', npmInstall).hookSpecificOutput!.decision!.behavior, 'allow');
  });

  it('la permission de l\'invite de questions elle-même n\'est jamais interceptée (sinon boucle infinie)', () => {
    const question = { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Timeout ?' }] } };
    assert.equal(hook('permission-request', question).hookSpecificOutput, undefined);
  });

  it('invite expirée sans réponse : bascule en mode sans humain (rien n\'est plus affiché, tout est consigné)', () => {
    hook('question-answered', { tool_name: 'AskUserQuestion', tool_response: 'The user may be away from their keyboard; proceed on your own judgment.' });
    const out = hook('guard-command', forcePush).hookSpecificOutput!;
    assert.equal(out.permissionDecision, 'deny');
    assert.match(out.permissionDecisionReason!, /MODE SANS HUMAIN/);
    assert.match(pending(), /git push --force/);
    // Une question de direction posée pendant l'absence est mise en file, pas affichée.
    const q = hook('ask-question', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Quelle base de données ?', options: [{ label: 'PostgreSQL' }, { label: 'SQLite' }] }] } });
    assert.equal(q.hookSpecificOutput!.permissionDecision, 'deny');
    assert.match(pending(), /QUESTION : Quelle base de données \? \[PostgreSQL \| SQLite\] → provisoire : PostgreSQL/);
    assert.match(q.hookSpecificOutput!.permissionDecisionReason!, /DÉCISION PROVISOIRE \(PostgreSQL\)/);
    // Permission native pendant l'absence : refusée et consignée.
    assert.equal(hook('permission-request', { tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } }).hookSpecificOutput!.decision!.behavior, 'deny');
  });

  it('décision coûteuse à changer pendant l\'absence : on ne construit pas dessus, seules les tâches dépendantes attendent', () => {
    const q = hook('ask-question', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ header: 'Archi', question: '[impact: fort] Monolithe ou microservices ?', options: [{ label: 'Monolithe modulaire (Recommandé)' }, { label: 'Microservices' }] }] } });
    const reason = q.hookSpecificOutput!.permissionDecisionReason!;
    assert.match(reason, /Ne construis PAS sur une supposition/);
    assert.match(reason, /bloque seulement les tâches qui dépendent/);
    assert.match(pending(), /Monolithe ou microservices \? .* → impact fort : tâches dépendantes en attente/);
  });

  it('décisions prises sans l\'humain : tracées et signalées à son retour', () => {
    const r = cli(dir, ['decision', 'add', '--title', 'ORM', '--context', 'c', '--decision', 'SQLAlchemy', '--consequences', 'x', '--status', 'provisional', '--impact', 'low', '--autonomous']);
    assert.equal(r.code, 0, r.stderr);
    const file = fs.readdirSync(path.join(dir, '.ceng/brain/decisions')).find((f) => f.includes('orm'))!;
    assert.match(fs.readFileSync(path.join(dir, '.ceng/brain/decisions', file), 'utf8'), /PROVISOIRE \(à confirmer\) · impact d'un changement : faible · prise sans l'humain/);
    const ctx = JSON.parse(runtimeHook(dir, 'session-start', { source: 'startup' }).stdout).hookSpecificOutput.additionalContext as string;
    assert.match(ctx, /Décisions prises sans l'humain à lui signaler/);
    assert.match(ctx, /ADR-\d{4}-orm/);
  });

  it('le travail continue sans attendre (session d\'orchestration)', () => {
    assert.equal(cli(dir, ['task', 'add', '--title', 'X', '--complexity', '2', '--files', 'app/x/**']).code, 0);
    const out = hook('stop', {});
    assert.equal(out.decision, 'block');
  });

  it('dès que l\'humain réécrit, il est de nouveau présent et les invites reviennent', () => {
    hook('user-prompt', { prompt: 'je suis là' });
    assert.match(hook('guard-command', forcePush).hookSpecificOutput!.permissionDecisionReason!, /AskUserQuestion/);
    const q = hook('ask-question', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Q ?' }] } });
    assert.equal(q.hookSpecificOutput, undefined, 'la question s\'affiche normalement');
  });

  it('bascule désactivable : retour aux boîtes de permission natives', () => {
    const other = sandbox('ts-library');
    dirs.push(other);
    assert.equal(cli(other, ['init', '--yes', '--presence', 'off']).code, 0);
    const r = runtimeHook(other, 'guard-command', { tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } });
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'ask');
    assert.equal(runtimeHook(other, 'permission-request', { tool_name: 'Bash', tool_input: { command: 'npm i x' } }).stdout, '');
  });
});
