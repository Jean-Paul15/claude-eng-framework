import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { cli, rm, runtimeHook, sandbox } from './helpers.js';

/**
 * Hook Stop en mode sans humain : ne relance pas l'orchestrateur tant que le travail faisable est chez des sous-agents,
 * y compris ceux que le suivi d'état ne connaît pas (lancés avant la mise à jour, jamais rattachés à une tâche).
 */
const dirs: string[] = [];
after(() => dirs.forEach(rm));

function project(maxParallel: number): string {
  const dir = sandbox('api-backend');
  dirs.push(dir);
  assert.equal(cli(dir, ['init', '--yes']).code, 0);
  const file = path.join(dir, '.ceng', 'config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8')) as { policy: { maxParallel: number } };
  config.policy.maxParallel = maxParallel;
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  return dir;
}

const night = (dir: string, event: string, payload: Record<string, unknown> = {}): string => {
  process.env['CENG_UNATTENDED'] = '1';
  try {
    return runtimeHook(dir, event, { session_id: 'n1', ...payload }).stdout;
  } finally {
    delete process.env['CENG_UNATTENDED'];
  }
};
const addTask = (dir: string, title: string, files: string): void => {
  assert.equal(cli(dir, ['task', 'add', '--title', title, '--complexity', '2', '--files', files]).code, 0);
};
const spawn = (dir: string, taskId: string) =>
  night(dir, 'agent-spawn', { tool_name: 'Agent', tool_input: { subagent_type: 'ceng-builder', description: `${taskId} travail`, prompt: `Tâche ${taskId}` } });

describe('Stop sans humain : travail délégué', () => {
  it('lancement sans suivi d\'état (agent d\'avant la mise à jour) : délégué tant qu\'aucun arrêt ne correspond', () => {
    const dir = project(3);
    addTask(dir, 'A', 'app/a/**');
    assert.equal(cli(dir, ['task', 'start', 'T-0001']).code, 0);
    spawn(dir, 'T-0001'); // pas de subagent-start : runningAgents reste vide
    assert.equal(night(dir, 'stop'), '', 'rien à faire pour l\'orchestrateur : l\'agent travaille');
    // L'agent s'arrête (sans avoir été rattaché) : l'orchestrateur doit reprendre la main.
    night(dir, 'subagent-stop', { agent_id: 'old-1', agent_type: 'ceng-builder', last_assistant_message: 'CENG_REPORT' });
    assert.equal(JSON.parse(night(dir, 'stop')).decision, 'block');
  });

  it('agent démarré sans tâche rattachée : il couvre la tâche en cours, pas de relance', () => {
    const dir = project(3);
    addTask(dir, 'A', 'app/a/**');
    assert.equal(cli(dir, ['task', 'start', 'T-0001']).code, 0);
    night(dir, 'subagent-start', { agent_id: 'orphan-1', agent_type: 'general-purpose' });
    assert.equal(night(dir, 'stop'), '');
    night(dir, 'subagent-stop', { agent_id: 'orphan-1', agent_type: 'general-purpose' });
    assert.equal(JSON.parse(night(dir, 'stop')).decision, 'block');
  });

  it('limite de parallélisme atteinte : pas de relance même s\'il reste des tâches prêtes', () => {
    const dir = project(1);
    addTask(dir, 'A', 'app/a/**');
    addTask(dir, 'B', 'app/b/**');
    assert.equal(cli(dir, ['task', 'start', 'T-0001']).code, 0);
    spawn(dir, 'T-0001');
    night(dir, 'subagent-start', { agent_id: 'a1', agent_type: 'ceng-builder' });
    const out = night(dir, 'stop');
    assert.equal(out, '');
    const last = fs.readFileSync(path.join(dir, '.ceng/logs/events.jsonl'), 'utf8').trim().split('\n').pop()!;
    assert.match(JSON.parse(last).data.reason, /limite de parallélisme/);
  });

  it('tâche prête et capacité disponible : l\'orchestrateur est relancé, avec la bonne tâche « prochaine »', () => {
    const dir = project(3);
    addTask(dir, 'A', 'app/a/**');
    addTask(dir, 'B', 'app/b/**');
    assert.equal(cli(dir, ['task', 'start', 'T-0001']).code, 0);
    spawn(dir, 'T-0001');
    const out = JSON.parse(night(dir, 'stop'));
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /prochaine : T-0002/);
  });

  it('les écritures de fichiers et les instantanés automatiques ne comptent pas comme progression', () => {
    const dir = project(3);
    addTask(dir, 'A', 'app/a/**');
    addTask(dir, 'B', 'app/b/**');
    let stopped = false;
    for (let i = 0; i < 6 && !stopped; i++) {
      night(dir, 'file-edited', { tool_name: 'Write', tool_input: { file_path: path.join(dir, `app/a/f${i}.ts`) } });
      night(dir, 'pre-compact', { trigger: 'auto' });
      stopped = night(dir, 'stop') === '';
    }
    assert.ok(stopped, 'arrêt faute de progression malgré les écritures et checkpoints automatiques');
  });
});
