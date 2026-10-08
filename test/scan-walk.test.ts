import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { detectPackageManagers } from '../src/discovery/stack.js';
import { createScanContext } from '../src/discovery/context.js';
import { listFiles } from '../src/infra/fs.js';

function tree(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ceng-walk-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

describe('parcours des fichiers', () => {
  it('par niveaux : un dossier profond qui remplit le plafond ne cache pas le manifeste de app/', () => {
    const deep: Record<string, string> = {};
    for (let i = 0; i < 30; i++) deep[`aaa/b/c/f${i}.txt`] = 'x';
    const root = tree({ ...deep, 'app/pubspec.yaml': 'environment:\n  sdk: flutter\n' });
    const { files, truncated } = listFiles(root, { maxFiles: 10 });
    assert.ok(truncated);
    assert.ok(files.includes('app/pubspec.yaml'));
  });

  it('les copies de travail des agents (.claude/worktrees) et le graphe de code ne sont jamais parcourus', () => {
    const root = tree({
      '.claude/worktrees/agent-1/app/pubspec.yaml': 'x',
      '.claude/settings.json': '{}',
      'graphify-out/graph.json': '{}',
      'app/pubspec.yaml': 'x',
    });
    const { files } = listFiles(root);
    assert.deepEqual(files.sort(), ['.claude/settings.json', 'app/pubspec.yaml']);
  });
});

describe('piles du dépôt', () => {
  it('un sous-dossier Python (ml/) ne fait pas du projet un projet Python', () => {
    const ctx = createScanContext(['ml/requirements.txt', 'ml/conftest.py', 'app/pubspec.yaml'], () => '');
    assert.ok(!detectPackageManagers(ctx).includes('pip'));
    const root = createScanContext(['requirements.txt'], () => '');
    assert.ok(detectPackageManagers(root).includes('pip'));
  });
});
