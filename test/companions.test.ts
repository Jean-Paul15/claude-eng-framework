import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { companionNotes } from '../src/cli/commands/setup.js';
import { rm } from './helpers.js';

const homes: string[] = [];
function home(settings?: object): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ceng-home-'));
  homes.push(dir);
  if (settings) {
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(settings));
  }
  return dir;
}
after(() => homes.forEach(rm));

describe('outils d\'économie de jetons installés par l\'utilisateur', () => {
  it('rien d\'installé : aucune note', () => {
    assert.deepEqual(companionNotes(home()), []);
    assert.deepEqual(companionNotes(home({ hooks: {} })), []);
  });

  it('RTK (hook de réécriture des commandes) est signalé avec le contournement', () => {
    const notes = companionNotes(home({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] }] } }));
    assert.equal(notes.length, 1);
    assert.equal(notes[0]!.name, 'rtk');
    assert.match(notes[0]!.detail, /RTK_DISABLED=1/);
  });

  it('Ponytail activé est signalé ; désactivé ou autre plugin : rien', () => {
    assert.equal(companionNotes(home({ enabledPlugins: { 'ponytail@ponytail': true } }))[0]!.name, 'ponytail');
    assert.deepEqual(companionNotes(home({ enabledPlugins: { 'ponytail@ponytail': false, 'autre@x': true } })), []);
  });
});
