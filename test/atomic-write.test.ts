import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { RENAME_ATTEMPTS, readJsonLinesTail, removeOrphanTemps, renameWithRetry, writeTextAtomic, type RenameOps } from '../src/infra/fs.js';
import { cli, rm, sandbox } from './helpers.js';

/** Écriture atomique robuste sous Windows : réessais sur fichier verrouillé, jamais de .tmp orphelin. */
const dirs: string[] = [];
const tmpDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ceng-atomic-'));
  dirs.push(dir);
  return dir;
};
after(() => dirs.forEach(rm));

const locked = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`${code}: fichier verrouillé`), { code });
const leftovers = (dir: string): string[] => fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));

/** Opérations simulées : `failures` échecs transitoires avant de réussir (rename réel). */
function flaky(code: string, failures: number): RenameOps & { attempts: number; sleeps: number[] } {
  const ops = {
    attempts: 0,
    sleeps: [] as number[],
    rename(from: string, to: string) {
      ops.attempts++;
      if (ops.attempts <= failures) throw locked(code);
      fs.renameSync(from, to);
    },
    sleep: (ms: number) => void ops.sleeps.push(ms),
  };
  return ops;
}

describe('écriture atomique', () => {
  it('réessaie sur EBUSY / EPERM / UNKNOWN avec un délai croissant puis réussit', () => {
    for (const code of ['EBUSY', 'EPERM', 'UNKNOWN']) {
      const dir = tmpDir();
      const target = path.join(dir, 'tasks.json');
      fs.writeFileSync(target, 'ancien');
      const ops = flaky(code, 3);
      writeTextAtomic(target, 'nouveau', ops);
      assert.equal(fs.readFileSync(target, 'utf8'), 'nouveau');
      assert.equal(ops.attempts, 4);
      assert.deepEqual(ops.sleeps, [15, 30, 60]);
      assert.deepEqual(leftovers(dir), []);
    }
  });

  it('échec persistant : erreur claire, ancien contenu intact, aucun .tmp orphelin', () => {
    const dir = tmpDir();
    const target = path.join(dir, 'tasks.json');
    fs.writeFileSync(target, 'ancien');
    const ops = flaky('UNKNOWN', 1000);
    assert.throws(() => writeTextAtomic(target, 'nouveau', ops), /Écriture de tasks\.json impossible \(UNKNOWN\).*verrouillé/);
    assert.equal(ops.attempts, RENAME_ATTEMPTS);
    assert.equal(fs.readFileSync(target, 'utf8'), 'ancien');
    assert.deepEqual(leftovers(dir), []);
  });

  it('erreur non transitoire : pas de réessai, temporaire nettoyé', () => {
    const dir = tmpDir();
    const ops = flaky('ENOSPC', 1000);
    assert.throws(() => writeTextAtomic(path.join(dir, 'x.json'), '{}', ops), /ENOSPC/);
    assert.equal(ops.attempts, 1);
    assert.deepEqual(leftovers(dir), []);
  });

  it('rename direct dans le cas normal (aucune copie de repli)', () => {
    const dir = tmpDir();
    const target = path.join(dir, 'state.json');
    renameWithRetry(target, target, { rename: () => undefined, sleep: () => assert.fail('pas d\'attente') });
    writeTextAtomic(target, '{"ok":true}\n');
    assert.equal(fs.readFileSync(target, 'utf8'), '{"ok":true}\n');
    assert.deepEqual(leftovers(dir), []);
  });

  it('nettoie les temporaires orphelins anciens, pas les récents ni les autres fichiers', () => {
    const dir = tmpDir();
    const old = path.join(dir, 'tasks.json.4242.deadbeef.tmp');
    const recent = path.join(dir, 'state.json.4243.cafebabe.tmp');
    fs.writeFileSync(old, 'x');
    fs.writeFileSync(recent, 'x');
    fs.writeFileSync(path.join(dir, 'tasks.json'), '{}');
    fs.writeFileSync(path.join(dir, 'notes.tmp'), 'à moi');
    const past = new Date(Date.now() - 3_600_000);
    fs.utimesSync(old, past, past);
    assert.deepEqual(removeOrphanTemps(dir), ['tasks.json.4242.deadbeef.tmp']);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['notes.tmp', 'state.json.4243.cafebabe.tmp', 'tasks.json']);
  });

  it('lecture de la fin d\'un gros journal', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'events.jsonl');
    fs.writeFileSync(file, Array.from({ length: 1000 }, (_, i) => JSON.stringify({ n: i })).join('\n') + '\n');
    const tail = readJsonLinesTail<{ n: number }>(file, 500);
    assert.ok(tail.length > 10 && tail.length < 1000);
    assert.equal(tail.at(-1)!.n, 999);
    assert.deepEqual(readJsonLinesTail(path.join(dir, 'absent.jsonl')), []);
  });
});

describe('.gitignore posé par init et upgrade', () => {
  it('couvre .ceng/brain/*.tmp, y compris pour un projet déjà initialisé', () => {
    const dir = sandbox('ts-library');
    dirs.push(dir);
    assert.equal(cli(dir, ['init', '--yes']).code, 0);
    assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^\.ceng\/brain\/\*\.tmp$/m);
    // Projet initialisé avant ce correctif : la ligne manque, `upgrade` la pose sans toucher au reste.
    const file = path.join(dir, '.gitignore');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('.ceng/brain/*.tmp\n', ''));
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\*\.tmp/);
    assert.equal(cli(dir, ['upgrade', '--yes']).code, 0);
    const after = fs.readFileSync(file, 'utf8');
    assert.match(after, /^\.ceng\/brain\/\*\.tmp$/m);
    assert.match(after, /^\.ceng\/logs\/$/m);
  });
});
