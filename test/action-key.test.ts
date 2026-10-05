import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { actionKey } from '../src/app/approvals.js';
import { commandActionMaterial, normalizeCommand, normalizeUnit } from '../src/domain/action-key.js';
import { approvalTriggers, isSingleUseCommand } from '../src/domain/guardrails.js';
import { cli, rm, runtimeHook, sandbox } from './helpers.js';

/**
 * Validations par ACTION : la clé ignore l'habillage d'une commande (redirections, `| tail`, `cd dossier &&`, espaces,
 * ordre des commandes) mais jamais ce qu'elle exécute ; une autorisation vaut 30 min pour la même action, sauf
 * opération destructive (usage unique).
 */
const dirs: string[] = [];
after(() => dirs.forEach(rm));

const key = (command: string, tool = 'Bash'): string => actionKey(tool, { command });

describe('normalisation d\'une commande (pure)', () => {
  it('retire redirections, filtres d\'affichage de fin de pipeline et espaces', () => {
    assert.equal(normalizeUnit('supabase  db push   --include-all 2>&1'), 'supabase db push --include-all');
    assert.equal(normalizeUnit('npm test > out.log 2>/dev/null'), 'npm test');
    assert.equal(normalizeUnit('npm test &>all.log'), 'npm test');
    assert.equal(normalizeCommand('supabase db push --include-all 2>&1 | tail -3'), 'supabase db push --include-all');
    assert.equal(normalizeCommand('npm run build | grep -i error | head -5'), 'npm run build');
  });

  it('conserve ce qui change l\'effet : filtre intermédiaire, guillemets, heredoc', () => {
    assert.equal(normalizeCommand('a | grep x | b'), 'a | grep x | b');
    assert.notEqual(normalizeCommand('git commit -m "a b"'), normalizeCommand('git commit -m "a  b"'));
    assert.match(normalizeUnit('cat <<EOF'), /<<EOF/);
  });

  it('retire le préfixe `cd <dossier> &&`, sauf si c\'est la seule instruction', () => {
    assert.equal(normalizeCommand('cd C:/Projets/app && flutter test'), 'flutter test');
    assert.equal(normalizeCommand('cd "mon dossier"; flutter test'), 'flutter test');
    assert.equal(normalizeCommand('cd app'), 'cd app');
  });
});

describe('clé d\'action', () => {
  const push = 'supabase db push --include-all';

  it('une même action a une seule clé, quel que soit son habillage', () => {
    const variants = [push, `${push} 2>&1`, `${push} 2>&1 | tail -3`, `cd supabase && ${push}`, `cd ../ && ${push} | head -50`, `  ${push}  `, `echo début && ${push}`, `${push} && echo fini`, `echo a; ${push}; echo b`];
    for (const v of variants) assert.equal(key(v), key(push), v);
    assert.equal(key(push, 'PowerShell'), key(push), 'outil indifférent');
  });

  it('une autre action a une autre clé', () => {
    assert.notEqual(key(`${push} --linked`), key(push));
    assert.notEqual(key('supabase db reset'), key(push));
    assert.notEqual(key('terraform apply'), key('terraform destroy'));
  });

  it('commande composée : la clé est celle des sous-commandes à risque, toutes ; en ajouter une change la clé', () => {
    assert.notEqual(key(`${push} && supabase db reset`), key(push), 'une validation de push ne couvre pas un reset ajouté');
    assert.equal(key(`${push} && npm publish`), key(`npm publish; ${push}`), 'ordre indifférent');
    assert.deepEqual(approvalTriggers(`cd x && ${push} 2>&1 | tail -3 && echo ok`).map((t) => t.rule), ['db-destructive']);
  });

  it('commande sans règle à risque (boîte native) : la commande entière, débarrassée de l\'habillage', () => {
    assert.equal(key('cd app && npm install left-pad 2>&1 | tail -3'), key('npm install left-pad'));
    assert.notEqual(key('npm install left-pad'), key('npm install right-pad'));
    assert.equal(commandActionMaterial('flutter test | head -20'), 'flutter test');
  });

  it('fichier : le chemin, outil indifférent', () => {
    assert.equal(actionKey('Edit', { file_path: 'a/B.ts' }), actionKey('Write', { file_path: 'a\\b.ts' }));
  });
});

describe('usage unique ou 30 minutes', () => {
  it('opérations destructives : usage unique', () => {
    for (const c of ['supabase db reset', 'psql -c "DROP TABLE users"', 'psql -c "TRUNCATE users"', 'psql -c "DELETE FROM users"', 'git reset --hard HEAD~1', 'rm -rf data', 'git push --force origin x', 'kubectl delete pod web', 'terraform destroy', 'prisma migrate reset', 'cd app && rm -r build_data | tail']) {
      assert.equal(isSingleUseCommand(c), true, c);
    }
  });

  it('déploiements et migrations : relançables pendant 30 min', () => {
    for (const c of ['supabase db push --include-all', 'supabase db push --include-all 2>&1 | tail -3', 'terraform apply', 'npm publish', 'vercel --prod', 'prisma migrate deploy', 'flutter pub publish', 'git push origin main']) {
      assert.equal(isSingleUseCommand(c), false, c);
    }
  });

  it('un déploiement accompagné d\'une opération destructive reste à usage unique', () => {
    assert.equal(isSingleUseCommand('supabase db push && psql -c "drop table t"'), true);
  });
});

describe('validation d\'une même action : de bout en bout', () => {
  const dir = sandbox('api-backend');
  dirs.push(dir);
  assert.equal(cli(dir, ['init', '--yes']).code, 0);
  type Out = { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string; additionalContext?: string } };
  const hook = (event: string, payload: Record<string, unknown>): Out => {
    const r = runtimeHook(dir, event, { session_id: 'k1', ...payload });
    return r.stdout ? (JSON.parse(r.stdout) as Out) : {};
  };
  const verdict = (command: string): string | undefined => hook('guard-command', { tool_name: 'Bash', tool_input: { command } }).hookSpecificOutput?.permissionDecision;
  const reasonOf = (command: string): string => hook('guard-command', { tool_name: 'Bash', tool_input: { command } }).hookSpecificOutput!.permissionDecisionReason!;
  const approve = (command: string, tool = 'guard-command'): string => {
    const payload = tool === 'guard-file' ? { tool_name: 'Edit', tool_input: { file_path: command } } : { tool_name: 'Bash', tool_input: { command } };
    const reason = hook(tool, payload).hookSpecificOutput!.permissionDecisionReason!;
    const id = reason.match(/R-\d{4}/)![0];
    hook('question-answered', { tool_response: { answers: { 'Valider ?': `Approuver ${id}` } } });
    return reason;
  };
  const push = 'supabase db push --include-all';

  it('approuvée une fois, la même action repasse pendant 30 min, quelle que soit sa forme ; une autre est redemandée', () => {
    hook('user-prompt', { prompt: 'on migre' });
    const asked = approve(`${push} 2>&1 | tail -3`);
    assert.match(asked, /30 min pour cette même action/);
    assert.doesNotMatch(asked, /une seule exécution/);
    for (const v of [push, `cd supabase && ${push}`, `${push} 2>&1 | tail -3`, `${push} 2>&1 | tail -3`, `echo go && ${push} | head -5`]) assert.equal(verdict(v), 'allow', v);
    assert.equal(verdict(`${push} --linked`), 'deny');
    assert.equal(verdict(`${push} && supabase db reset`), 'deny', 'une opération destructive ajoutée n\'est pas couverte');
  });

  it('une demande ouverte n\'est pas dupliquée par une variante de la même commande', () => {
    const first = reasonOf('terraform apply 2>&1 | tail -3').match(/R-\d{4}/)![0];
    assert.equal(reasonOf('cd infra && terraform apply').match(/R-\d{4}/)![0], first);
  });

  it('opération destructive : usage unique', () => {
    const asked = approve('supabase db reset');
    assert.match(asked, /une seule exécution/);
    assert.equal(verdict('supabase db reset 2>&1 | tail -2'), 'allow');
    assert.equal(verdict('supabase db reset'), 'deny');
  });

  it('fichier de gouvernance : chaque modification est une décision (usage unique)', () => {
    approve('.ceng/config.json', 'guard-file');
    const edit = { tool_name: 'Edit', tool_input: { file_path: '.ceng/config.json' } };
    assert.equal(hook('guard-file', edit).hookSpecificOutput?.permissionDecision, 'allow');
    assert.equal(hook('guard-file', edit).hookSpecificOutput?.permissionDecision, 'deny');
  });

  it('l\'autorisation expire au bout de 30 min', () => {
    approve('terraform apply');
    assert.equal(verdict('terraform apply'), 'allow');
    const stateFile = path.join(dir, '.ceng', 'brain', 'state.json');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as { grants: { expiresAt: string }[] };
    assert.ok(state.grants.length > 0);
    for (const g of state.grants) g.expiresAt = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(stateFile, JSON.stringify(state));
    assert.equal(verdict('terraform apply'), 'deny');
  });

  it('`config detect --apply` demande la validation humaine ; `config detect` seul est libre', () => {
    assert.equal(verdict('node .ceng/runtime/cli.js config detect'), undefined);
    assert.equal(verdict('node .ceng/runtime/cli.js config detect --apply'), 'deny');
    assert.equal(verdict('ceng config detect --dir x --apply 2>&1 | tail -5'), 'deny');
  });
});
