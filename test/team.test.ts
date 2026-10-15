import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { classifyTeamTool } from '../src/domain/team.js';
import { cli, json, rm, runtimeHook, sandbox } from './helpers.js';

/**
 * Mode « équipe autonome » : le framework tranche les permissions à la place d'un humain absent, selon une liste de sécurité fermée.
 * Lecture, coordination et outils locaux passent ; ce qui agit hors de la machine (base de production, déploiement, e-mail, paiement,
 * secrets) est refusé proprement et consigné pour l'humain, sans jamais attendre.
 */
const dirs: string[] = [];
after(() => dirs.forEach(rm));

describe('classification des outils (pure)', () => {
  const decision = (tool: string, options = {}) => classifyTeamTool(tool, options).decision;

  it('outils natifs sans effet extérieur : autorisés', () => {
    for (const t of ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Agent', 'Skill', 'Monitor', 'SendMessage', 'WebSearch']) assert.equal(decision(t), 'allow', t);
  });

  it('coordination entre sessions et outils locaux : autorisés', () => {
    for (const t of ['mcp__ccd_session_mgmt__send_message', 'mcp__ccd_session_mgmt__set_session_model', 'mcp__ccd_session_mgmt__list_sessions', 'mcp__Claude_Browser__navigate', 'mcp__plugin_playwright_playwright__browser_click', 'mcp__chrome-devtools__take_snapshot']) {
      assert.equal(decision(t), 'allow', t);
    }
  });

  it('jamais d\'auto-élévation ni de suppression de session', () => {
    for (const t of ['mcp__ccd_session_mgmt__set_session_permission_mode', 'mcp__ccd_session_mgmt__delete_session', 'mcp__ccd_session_mgmt__archive_session']) {
      assert.equal(decision(t), 'defer', t);
    }
  });

  it('services externes : lecture permise, tout le reste à l\'humain', () => {
    for (const t of ['mcp__supabase__list_tables', 'mcp__supabase__get_advisors', 'mcp__convex__logs']) assert.equal(decision(t), 'allow', t);
    for (const t of [
      'mcp__supabase__execute_sql', 'mcp__supabase__apply_migration', 'mcp__supabase__deploy_edge_function', 'mcp__29d2a6b5-b193-45d1-9007-9f07679b2a8f__apply_migration',
      'mcp__a076e1fd-00c8-48ab-a859-a97b7a3b22d6__send_message', 'mcp__convex__envSet', 'mcp__convex__run', 'mcp__claude-in-chrome__computer',
    ]) {
      assert.equal(decision(t), 'defer', t);
    }
  });

  it('outil inconnu : à l\'humain ; les listes de la configuration l\'emportent', () => {
    assert.equal(decision('NouvelOutil'), 'defer');
    assert.equal(decision('mcp__monserveur__faire_quelque_chose'), 'defer');
    assert.equal(decision('mcp__monserveur__faire_quelque_chose', { mcpAllow: ['mcp__monserveur__*'] }), 'allow');
    assert.equal(decision('mcp__supabase__list_tables', { mcpDefer: ['mcp__supabase__*'] }), 'defer');
  });
});

describe('mode équipe dans les hooks', () => {
  const dir = sandbox('api-backend');
  dirs.push(dir);
  assert.equal(cli(dir, ['init', '--yes']).code, 0);
  const hook = (event: string, payload: unknown) => runtimeHook(dir, event, payload);
  const pending = () => (fs.existsSync(path.join(dir, '.ceng/brain/pending-approvals.md')) ? fs.readFileSync(path.join(dir, '.ceng/brain/pending-approvals.md'), 'utf8') : '');

  it('désactivé par défaut : les outils MCP ne sont pas touchés', () => {
    assert.equal(hook('guard-mcp', { tool_name: 'mcp__supabase__execute_sql', tool_input: {} }).stdout, '');
    assert.match(cli(dir, ['team', 'status']).stdout, /désactivée/);
  });

  it('activer le mode est une décision humaine pour l\'agent, pas pour l\'humain qui lance la commande', () => {
    const asAgent = JSON.parse(hook('guard-command', { tool_name: 'Bash', tool_input: { command: 'node .ceng/runtime/cli.js team on' } }).stdout);
    assert.equal(asAgent.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(asAgent.hookSpecificOutput.permissionDecisionReason, /équipe autonome|Approuver R-/i);
    assert.equal(cli(dir, ['team', 'on']).code, 0);
    assert.match(cli(dir, ['team', 'status']).stdout, /ACTIVÉE/);
    assert.equal(json<{ team: { enabled: boolean } }>(cli(dir, ['team', 'status', '--json'])).team.enabled, true);
  });

  it('outil MCP de lecture ou de coordination : autorisé sans boîte de permission', () => {
    for (const tool of ['mcp__supabase__list_tables', 'mcp__ccd_session_mgmt__send_message']) {
      const out = JSON.parse(hook('guard-mcp', { tool_name: tool, tool_input: {} }).stdout);
      assert.equal(out.hookSpecificOutput.permissionDecision, 'allow', tool);
    }
  });

  it('outil MCP à effet extérieur : refusé proprement, consigné pour l\'humain, sans attendre', () => {
    const out = JSON.parse(hook('guard-mcp', { tool_name: 'mcp__supabase__apply_migration', tool_input: { name: 'x' } }).stdout);
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /MODE SANS HUMAIN/);
    assert.match(pending(), /mcp__supabase__apply_migration/);
  });

  it('boîte de permission native : commande autonome autorisée, action à approbation refusée et consignée', () => {
    const ok = JSON.parse(hook('permission-request', { tool_name: 'Bash', tool_input: { command: 'git status' } }).stdout);
    assert.equal(ok.hookSpecificOutput.decision.behavior, 'allow');
    const no = JSON.parse(hook('permission-request', { tool_name: 'Bash', tool_input: { command: 'npm publish' } }).stdout);
    assert.equal(no.hookSpecificOutput.decision.behavior, 'deny');
    assert.match(pending(), /npm publish/);
    const forbidden = JSON.parse(hook('permission-request', { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }).stdout);
    assert.equal(forbidden.hookSpecificOutput.decision.behavior, 'deny');
  });

  it('boîte de permission native : écriture dans le projet autorisée, hors du projet refusée', () => {
    const inside = JSON.parse(hook('permission-request', { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'notes.md') } }).stdout);
    assert.equal(inside.hookSpecificOutput.decision.behavior, 'allow');
    const temp = JSON.parse(hook('permission-request', { tool_name: 'Write', tool_input: { file_path: path.join(os.tmpdir(), 'ceng-scratch.txt') } }).stdout);
    assert.equal(temp.hookSpecificOutput.decision.behavior, 'allow');
    const outside = JSON.parse(hook('permission-request', { tool_name: 'Write', tool_input: { file_path: path.join(path.parse(dir).root, 'Windows', 'evil.txt') } }).stdout);
    assert.equal(outside.hookSpecificOutput.decision.behavior, 'deny');
  });

  it('une approbation requise par la garde de commandes est consignée au lieu de demander', () => {
    const out = JSON.parse(hook('guard-command', { tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } }).stdout);
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /MODE SANS HUMAIN/);
  });

  it('désactiver le mode rétablit le comportement d\'origine', () => {
    assert.equal(cli(dir, ['team', 'off']).code, 0);
    assert.equal(hook('guard-mcp', { tool_name: 'mcp__supabase__apply_migration', tool_input: {} }).stdout, '');
  });
});
