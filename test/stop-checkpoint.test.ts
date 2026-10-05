import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import type { BrainState, CheckpointRecord } from '../src/brain/store.js';
import { cli, json, rm, runtimeHook, sandbox } from './helpers.js';

/**
 * Fin de tour : plus aucun blocage pour un checkpoint. Un checkpoint AUTOMATIQUE silencieux protège le travail de la
 * session principale (pas celui des sous-agents) ; au plus un rappel non bloquant toutes les 2 h si aucun checkpoint
 * volontaire n'a été pris depuis 2 h.
 */
const dirs: string[] = [];
after(() => dirs.forEach(rm));

const HOUR = 3_600_000;

function project() {
  const dir = sandbox('api-backend');
  dirs.push(dir);
  assert.equal(cli(dir, ['init', '--yes']).code, 0);
  const file = path.join(dir, 'app', 'auth', 'routes.py');
  const stateFile = path.join(dir, '.ceng', 'brain', 'state.json');
  const cpFile = path.join(dir, '.ceng', 'brain', 'checkpoints.jsonl');
  return {
    dir,
    edit: (agent?: string) => runtimeHook(dir, 'file-edited', { tool_name: 'Edit', tool_input: { file_path: file }, ...(agent ? { agent_id: agent, agent_type: 'general-purpose' } : {}) }),
    stop: () => runtimeHook(dir, 'stop', { session_id: 's1' }),
    state: () => (fs.existsSync(stateFile) ? (JSON.parse(fs.readFileSync(stateFile, 'utf8')) as BrainState) : ({ editsSinceCheckpoint: 0, sessions: 0 } as BrainState)),
    patchState: (fn: (s: BrainState) => void) => {
      const s = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as BrainState;
      fn(s);
      fs.writeFileSync(stateFile, JSON.stringify(s));
    },
    checkpoints: () => json<CheckpointRecord[]>(cli(dir, ['checkpoint', 'list', '--json'])),
    /** Vieillit tous les checkpoints existants. */
    ageCheckpoints: (ms: number) => {
      const lines = fs.readFileSync(cpFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as CheckpointRecord);
      fs.writeFileSync(cpFile, lines.map((c) => JSON.stringify({ ...c, at: new Date(Date.parse(c.at) - ms).toISOString() })).join('\n') + '\n');
    },
  };
}

describe('Stop : checkpoint automatique silencieux', () => {
  it('modification de la session principale : checkpoint automatique, aucun blocage, compteur remis à zéro', () => {
    const p = project();
    p.edit();
    p.edit();
    assert.equal(p.state().editsSinceCheckpoint, 2);
    const out = p.stop();
    assert.equal(out.code, 0);
    assert.ok(!out.stdout.includes('"decision"'), 'jamais de blocage');
    const auto = p.checkpoints().at(-1)!;
    assert.equal(auto.auto, true);
    assert.equal(auto.done, 'Checkpoint automatique en fin de tour (2 fichiers)');
    assert.ok(auto.snapshot, 'instantané git pris');
    assert.equal(p.state().editsSinceCheckpoint, 0);
    assert.equal(p.checkpoints().length, 1, 'un seul checkpoint par tour');
  });

  it('sans tâche en cours aussi, et pas de checkpoint quand rien n\'a changé', () => {
    const p = project();
    assert.equal(p.stop().stdout, '');
    assert.equal(p.checkpoints().length, 0);
    p.edit();
    p.stop();
    assert.equal(p.checkpoints().length, 1);
    assert.equal(p.stop().stdout, '');
    assert.equal(p.checkpoints().length, 1);
  });

  it('la prochaine étape reprise est celle du dernier checkpoint VOLONTAIRE, pas d\'un checkpoint automatique', () => {
    const p = project();
    assert.equal(cli(p.dir, ['checkpoint', '--done', 'jalon', '--next', 'brancher le webhook']).code, 0);
    p.edit();
    p.stop();
    p.edit();
    p.stop();
    const [, a1, a2] = p.checkpoints();
    assert.equal(a1!.next, 'brancher le webhook');
    assert.equal(a2!.next, 'brancher le webhook');
  });

  it('les modifications des sous-agents ne comptent pas (mais le graphe de code les voit)', () => {
    const p = project();
    p.edit('agent-1');
    p.edit('agent-2');
    assert.equal(p.state().editsSinceCheckpoint, 0);
    assert.equal(p.state().graphDirty, true);
    assert.equal(p.stop().stdout, '');
    assert.equal(p.checkpoints().length, 0);
    p.edit();
    p.edit('agent-1');
    assert.equal(p.state().editsSinceCheckpoint, 1);
  });

  it('le Stop d\'un sous-agent ne crée rien', () => {
    const p = project();
    p.edit();
    runtimeHook(p.dir, 'stop', { agent_id: 'agent-1' });
    assert.equal(p.checkpoints().length, 0);
    assert.equal(p.state().editsSinceCheckpoint, 1);
  });
});

describe('Stop : rappel non bloquant de checkpoint volontaire', () => {
  const reminder = (stdout: string): string | undefined => (stdout ? (JSON.parse(stdout) as { systemMessage?: string }).systemMessage : undefined);

  it('aucun checkpoint volontaire : un seul rappel, puis plus pendant 2 h', () => {
    const p = project();
    p.edit();
    const first = p.stop();
    assert.match(reminder(first.stdout) ?? '', /Aucun checkpoint volontaire depuis plus de 2 h/);
    assert.ok(!first.stdout.includes('"decision"'), 'rappel non bloquant');
    p.edit();
    assert.equal(p.stop().stdout, '', 'déjà rappelé');
    p.patchState((s) => {
      s.checkpointReminderAt = new Date(Date.now() - 2 * HOUR - 1000).toISOString();
    });
    p.edit();
    assert.match(reminder(p.stop().stdout) ?? '', /checkpoint volontaire/, '2 h plus tard : nouveau rappel possible');
  });

  it('un checkpoint volontaire récent : aucun rappel ; périmé (> 2 h) : rappel', () => {
    const p = project();
    assert.equal(cli(p.dir, ['checkpoint', '--done', 'jalon', '--next', 'suite']).code, 0);
    p.edit();
    assert.equal(p.stop().stdout, '');
    p.ageCheckpoints(3 * HOUR);
    p.edit();
    assert.match(reminder(p.stop().stdout) ?? '', /checkpoint volontaire/);
  });

  it('un checkpoint automatique ne remet pas le compteur de rappel à zéro', () => {
    const p = project();
    p.edit();
    p.stop();
    const at = p.state().checkpointReminderAt;
    assert.ok(at);
    p.edit();
    p.stop();
    assert.equal(p.state().checkpointReminderAt, at);
  });

  it('pas de rappel sans travail dans le tour (simple conversation)', () => {
    const p = project();
    assert.equal(p.stop().stdout, '');
    assert.equal(p.state().checkpointReminderAt, undefined);
  });
});
