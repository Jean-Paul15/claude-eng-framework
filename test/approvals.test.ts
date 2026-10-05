import { strict as assert } from 'node:assert';
import { after, describe, it } from 'node:test';
import { extractAnswers, isTimeout, readVerdicts } from '../src/domain/answers.js';
import { cli, rm, runtimeHook, sandbox } from './helpers.js';

/**
 * Approbations humaines de bout en bout : demande → question → réponse → la commande passe, UNE fois ;
 * refus → bloquée ; une autre commande ne profite jamais d'une approbation.
 */
const dirs: string[] = [];
after(() => dirs.forEach(rm));

type Out = {
  decision?: string;
  hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string; additionalContext?: string; decision?: { behavior: string; message?: string } };
};

describe('lecture de la réponse de l\'humain (pure)', () => {
  const q = { questions: [{ question: 'Q ?', options: [{ label: 'Approuver R-0007' }, { label: 'Refuser R-0007' }] }] };

  it('forme structurée : seules les valeurs de `answers` comptent, pas la liste des options', () => {
    assert.deepEqual(readVerdicts(extractAnswers({ ...q, answers: { 'Q ?': 'Refuser R-0007' } })).map((v) => [v.id, v.decision]), [['R-0007', 'refuse']]);
    assert.deepEqual(readVerdicts(extractAnswers({ ...q, answers: { 'Q ?': 'Approuver R-0007' } })).map((v) => [v.id, v.decision]), [['R-0007', 'approve']]);
  });

  it('texte brut : « question »=« réponse »', () => {
    const text = 'User has answered your questions: "Lancer terraform apply sur Approuver R-0001 ou Refuser R-0001 ?"="Approuver R-0003". You can now continue.';
    assert.deepEqual(readVerdicts(extractAnswers(text)).map((v) => [v.id, v.decision]), [['R-0003', 'approve']]);
  });

  it('options reformulées : l\'identifiant dans l\'option choisie suffit', () => {
    for (const label of ['✅ Approuver (R-0004)', 'Oui, approuver R-0004', 'Approuver R-0004 — je comprends le risque', 'approve R-0004']) {
      assert.equal(readVerdicts([label])[0]?.decision, 'approve', label);
    }
    for (const label of ['Refuser R-0004', '❌ Non (R-0004)', 'Refuser R-0004 : trop risqué, pas approuvé', 'Deny R-0004']) {
      assert.equal(readVerdicts([label])[0]?.decision, 'refuse', label);
    }
    assert.equal(readVerdicts(['Peut-être R-0004'])[0]?.decision, 'unclear');
  });

  it('contradiction sur un même identifiant : le refus l\'emporte', () => {
    assert.equal(readVerdicts(['Approuver R-0009', 'Refuser R-0009'])[0]?.decision, 'refuse');
  });

  it('expiration de l\'invite reconnue, une vraie réponse jamais prise pour une expiration', () => {
    assert.ok(isTimeout('The user may be away from their keyboard; proceed on your own judgment.'));
    assert.ok(!isTimeout({ answers: { 'Le build a timed out waiting, relancer ?': 'Oui' } }));
    assert.ok(!isTimeout('User has answered your questions: "Timeout ?"="Approuver R-0001".'));
  });
});

describe('approbation de bout en bout', () => {
  const dir = sandbox('api-backend');
  dirs.push(dir);
  assert.equal(cli(dir, ['init', '--yes']).code, 0);
  const hook = (event: string, payload: Record<string, unknown>): Out => {
    const r = runtimeHook(dir, event, { session_id: 's1', ...payload });
    return r.stdout ? (JSON.parse(r.stdout) as Out) : {};
  };
  const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } });
  const deploy = 'terraform apply -auto-approve';
  const publish = 'npm publish';
  const other = 'terraform destroy';
  const ask = (command: string): string => {
    const out = hook('guard-command', bash(command)).hookSpecificOutput!;
    assert.equal(out.permissionDecision, 'deny', command);
    return out.permissionDecisionReason!;
  };
  const answer = (choice: string, question = 'Question reformulée librement par Claude ?') =>
    hook('question-answered', { tool_name: 'AskUserQuestion', tool_response: { questions: [{ question, options: [{ label: choice.replace(/^\S+/, 'Approuver') }, { label: choice.replace(/^\S+/, 'Refuser') }] }], answers: { [question]: choice } } });
  const verdict = (command: string) => hook('guard-command', bash(command)).hookSpecificOutput?.permissionDecision;
  let id = '';

  it('1. la demande reçoit un identifiant unique et un message clair', () => {
    hook('user-prompt', { prompt: 'on déploie' });
    const reason = ask(deploy);
    id = reason.match(/R-\d{4}/)![0];
    assert.equal(id, 'R-0001');
    assert.match(reason, /AskUserQuestion/);
    assert.match(reason, new RegExp(`Approuver ${id}`));
    assert.match(reason, new RegExp(`Refuser ${id}`));
    assert.match(reason, /une seule exécution/);
    assert.match(ask(deploy), new RegExp(id), 'même action redemandée : même demande');
  });

  it('2. l\'approbation est enregistrée (hook synchrone) et Claude est informé', () => {
    const out = answer(`Approuver ${id}`);
    assert.match(out.hookSpecificOutput!.additionalContext!, new RegExp(`Approbation enregistrée pour ${id}`));
    assert.match(out.hookSpecificOutput!.additionalContext!, /relance/);
  });

  it('3. une autre commande ne profite pas de l\'approbation', () => {
    const reason = ask(other);
    assert.match(reason, /R-0002/);
    assert.equal(verdict('terraform apply'), 'deny');
  });

  it('4. la commande approuvée passe, une seule fois, y compris la boîte de permission native de la même exécution', () => {
    assert.equal(verdict(deploy), 'allow');
    // Règle `ask` native : PermissionRequest voit la même exécution (relais), sans autorisation supplémentaire.
    assert.equal(hook('permission-request', bash(deploy)).hookSpecificOutput!.decision!.behavior, 'allow');
    // Exécution suivante : une nouvelle demande, avec un NOUVEL identifiant (jamais réutilisé).
    const again = ask(deploy);
    assert.notEqual(again.match(/R-\d{4}/)![0], id);
    assert.equal(hook('permission-request', bash(deploy)).hookSpecificOutput!.decision!.behavior, 'deny');
  });

  it('5. un identifiant déjà utilisé est signalé clairement, sans autorisation', () => {
    const out = answer(`Approuver ${id}`);
    assert.match(out.hookSpecificOutput!.additionalContext!, /ne correspond à aucune demande ouverte/);
    assert.equal(verdict(deploy), 'deny');
  });

  it('6. refus : la commande reste bloquée et n\'est pas redemandée', () => {
    const publishId = ask(publish).match(/R-\d{4}/)![0];
    const out = answer(`Refuser ${publishId}`);
    assert.match(out.hookSpecificOutput!.additionalContext!, new RegExp(`Refus enregistré pour ${publishId}`));
    assert.match(ask(publish), /refusée par l'humain/);
    assert.equal(hook('permission-request', bash(publish)).hookSpecificOutput!.decision!.behavior, 'deny');
    // Nouveau message de l'humain : la discussion est rouverte, une nouvelle demande est possible.
    hook('user-prompt', { prompt: 'finalement oui, republie' });
    const reopened = ask(publish);
    assert.match(reopened, /Approuver R-\d{4}/);
    assert.notEqual(reopened.match(/R-\d{4}/)![0], publishId);
  });

  it('7. options reformulées : « Oui, approuver (R-xxxx) » autorise', () => {
    const reopenedId = ask(publish).match(/R-\d{4}/)![0];
    answer(`Oui, approuver (${reopenedId})`);
    assert.equal(verdict(publish), 'allow');
  });

  it('8. une réponse réelle prouve la présence : plus de mode sans humain après une expiration', () => {
    hook('question-answered', { tool_name: 'AskUserQuestion', tool_response: 'The user may be away from their keyboard; proceed on your own judgment.' });
    assert.match(ask(other), /MODE SANS HUMAIN/);
    const fresh = hook('question-answered', { tool_name: 'AskUserQuestion', tool_response: { answers: { 'Autre sujet ?': 'Option A' } } });
    assert.equal(fresh.hookSpecificOutput, undefined);
    assert.match(ask(other), /Approuver R-\d{4}/);
  });
});

describe('boîte de permission native seule (commande autonome pour le hook)', () => {
  const dir = sandbox('api-backend');
  dirs.push(dir);
  assert.equal(cli(dir, ['init', '--yes']).code, 0);
  const call = (event: string, payload: Record<string, unknown>): Out => {
    const r = runtimeHook(dir, event, { session_id: 's2', ...payload });
    return r.stdout ? (JSON.parse(r.stdout) as Out) : {};
  };
  const npmInstall = { tool_name: 'Bash', tool_input: { command: 'npm install left-pad' } };

  it('autorisation à usage unique : la deuxième boîte identique est refusée', () => {
    call('user-prompt', { prompt: 'installe-le' });
    const denied = call('permission-request', npmInstall).hookSpecificOutput!.decision!;
    assert.equal(denied.behavior, 'deny');
    const id = denied.message!.match(/R-\d{4}/)![0];
    call('question-answered', { tool_response: { answers: { 'Installer left-pad ?': `Approuver ${id}` } } });
    assert.equal(call('permission-request', npmInstall).hookSpecificOutput!.decision!.behavior, 'allow');
    assert.equal(call('permission-request', npmInstall).hookSpecificOutput!.decision!.behavior, 'deny');
  });
});

describe('présence en mode nuit', () => {
  const dir = sandbox('api-backend');
  dirs.push(dir);
  assert.equal(cli(dir, ['init', '--yes']).code, 0);
  const night = (event: string, payload: Record<string, unknown>): Out => {
    process.env['CENG_UNATTENDED'] = '1';
    try {
      const r = runtimeHook(dir, event, { session_id: 'n1', ...payload });
      return r.stdout ? (JSON.parse(r.stdout) as Out) : {};
    } finally {
      delete process.env['CENG_UNATTENDED'];
    }
  };
  const push = { tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } };

  it('le message de lancement du mode nuit ne prouve pas la présence', () => {
    night('user-prompt', { prompt: '/ceng-orchestrate MODE SANS HUMAIN — personne ne peut répondre' });
    assert.match(night('guard-command', push).hookSpecificOutput!.permissionDecisionReason!, /MODE SANS HUMAIN/);
  });

  it('un vrai message de l\'humain pendant la session le rend présent : on lui pose la question au lieu de consigner', () => {
    night('user-prompt', { prompt: 'je suis devant l\'écran, vas-y' });
    const reason = night('guard-command', push).hookSpecificOutput!.permissionDecisionReason!;
    assert.match(reason, /AskUserQuestion/);
    assert.match(reason, /Approuver R-\d{4}/);
    // Une question de direction s'affiche normalement (non mise en file).
    assert.equal(night('ask-question', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Q ?' }] } }).hookSpecificOutput, undefined);
  });

  it('presence.enabled=false : jamais d\'invite, boîtes natives (même avec un humain présent)', () => {
    const off = sandbox('ts-library');
    dirs.push(off);
    assert.equal(cli(off, ['init', '--yes', '--presence', 'off']).code, 0);
    runtimeHook(off, 'user-prompt', { prompt: 'bonjour' });
    const out = JSON.parse(runtimeHook(off, 'guard-command', push).stdout) as Out;
    assert.equal(out.hookSpecificOutput!.permissionDecision, 'ask');
  });
});
