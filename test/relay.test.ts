import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { ackRelay, emitRelayEvent, mainRoot, pendingRelay, relayEvents, suggestedAction, watchRelay } from '../src/app/relay.js';
import { cli, json, rm, sandbox } from './helpers.js';

/**
 * Relais entre sessions : une session signale un point d'arrêt, la coordination l'attend sans rien lire ni payer entre-temps.
 * Le fichier d'événements est toujours dans le dépôt principal, même quand l'émetteur travaille dans une copie de travail (worktree).
 */
const dirs: string[] = [];
after(() => dirs.forEach(rm));

describe('relais', () => {
  const main = sandbox('api-backend');
  dirs.push(main);
  const worktree = path.join(path.dirname(main), `${path.basename(main)}-wt`);
  dirs.push(worktree);
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'rpg/integration', worktree], { cwd: main, stdio: 'pipe' });

  it('la racine principale est trouvée depuis une copie de travail', () => {
    assert.equal(fs.realpathSync.native(mainRoot(worktree)), fs.realpathSync.native(main));
    assert.equal(fs.realpathSync.native(mainRoot(main)), fs.realpathSync.native(main));
  });

  it('une session émet depuis sa copie, la coordination lit dans le dépôt principal', () => {
    const e = emitRelayEvent(worktree, { kind: 'opus-ready', session: '4', ref: 'docs/rpg/integration/DOSSIER_4_1.md', note: 'contrat prêt' });
    assert.equal(e.seq, 1);
    assert.ok(fs.existsSync(path.join(main, '.ceng', 'relay', 'events.jsonl')));
    assert.equal(fs.existsSync(path.join(worktree, '.ceng', 'relay', 'events.jsonl')), false);
    assert.deepEqual(relayEvents(main).map((x) => [x.seq, x.kind, x.session]), [[1, 'opus-ready', '4']]);
  });

  it('numéros croissants, curseur par lecteur, rien n\'est renvoyé deux fois', () => {
    emitRelayEvent(main, { kind: 'opus-done', session: '4' });
    assert.deepEqual(pendingRelay(main, 'coordination').map((x) => x.seq), [1, 2]);
    ackRelay(main, 'coordination', 1);
    assert.deepEqual(pendingRelay(main, 'coordination').map((x) => x.seq), [2]);
    assert.deepEqual(pendingRelay(main, 'autre').map((x) => x.seq), [1, 2], 'un autre lecteur a son propre curseur');
  });

  it('la consigne recommandée dit quoi faire pour chaque type d\'événement', () => {
    const [ready, done] = relayEvents(main);
    assert.match(suggestedAction(ready!), /set_session_model/);
    assert.match(suggestedAction(ready!), /Opus/);
    assert.match(suggestedAction(ready!), /DOSSIER_4_1\.md/);
    assert.match(suggestedAction(done!), /Sonnet/);
  });

  it('watch : silencieux au départ, une notification par nouvel événement, avec reprise du curseur', async () => {
    const seen: number[] = [];
    const abort = new AbortController();
    const watching = watchRelay(main, { reader: 'veille', intervalMs: 20, onEvent: (e) => seen.push(e.seq), signal: abort.signal });
    await new Promise((r) => setTimeout(r, 80));
    assert.deepEqual(seen, [], 'les événements déjà là ne sont pas rejoués');
    emitRelayEvent(worktree, { kind: 'blocked', session: '6', note: 'attend le contrat' });
    emitRelayEvent(worktree, { kind: 'decision-needed', session: '5' });
    await new Promise((r) => setTimeout(r, 150));
    abort.abort();
    await watching;
    assert.deepEqual(seen, [3, 4]);
    assert.deepEqual(pendingRelay(main, 'veille'), []);
  });

  it('la ligne du fichier abîmée est ignorée, jamais bloquante', () => {
    fs.appendFileSync(path.join(main, '.ceng', 'relay', 'events.jsonl'), '{pas du json\n', 'utf8');
    emitRelayEvent(main, { kind: 'custom', session: 'x', note: 'après une ligne abîmée' });
    assert.equal(relayEvents(main).at(-1)?.kind, 'custom');
  });

  it('commande ceng relay : émettre depuis une copie de travail, lire en JSON', () => {
    const emitted = json<{ seq: number; kind: string }>(cli(worktree, ['relay', 'emit', '--kind', 'opus-ready', '--session', '6', '--ref', 'docs/rpg/integration/DOSSIER_6_1.md', '--json']));
    assert.equal(emitted.kind, 'opus-ready');
    const list = json<{ seq: number; kind: string }[]>(cli(main, ['relay', 'events', '--all', '--json']));
    assert.equal(list.at(-1)?.seq, emitted.seq);
    assert.equal(cli(main, ['relay', 'emit', '--kind', 'inconnu', '--session', '1']).code, 2);
  });
});
