import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { checkCode } from '../src/domain/code-check.js';
import { cli, rm, runtimeHook, sandbox } from './helpers.js';

const rules = (file: string, text: string, total = 10) => checkCode(file, text, total).map((f) => `${f.severity}:${f.rule}`);
const dirs: string[] = [];
after(() => dirs.forEach(rm));

describe('contrôle immédiat du code écrit', () => {
  it('code propre : rien à signaler (aucun jeton dépensé)', () => {
    assert.deepEqual(rules('src/orders.ts', 'export function total(items: Item[]): number {\n  return items.reduce((s, i) => s + i.price, 0);\n}\n'), []);
  });

  it('sécurité : bloquant', () => {
    assert.ok(rules('src/db.ts', 'const q = `SELECT id FROM users WHERE email = ${email}`;').includes('block:sql-injection'));
    assert.ok(rules('src/pay.ts', `const key = "sk_live_${'a'.repeat(24)}";`).includes('block:hardcoded-secret'));
    assert.ok(rules('src/x.js', 'const f = eval(input);').includes('block:eval'));
  });

  it('robustesse, restes de mise au point, performance : avertissement', () => {
    assert.ok(rules('src/a.ts', 'try { run() } catch (e) {}').includes('warn:empty-catch'));
    assert.ok(rules('src/a.ts', 'console.log(user)').includes('warn:debug-leftover'));
    assert.deepEqual(rules('test/a.test.ts', 'console.log(user)'), [], 'toléré dans un test');
    assert.ok(rules('src/a.ts', 'let x: any = 1').includes('warn:any-type'));
    assert.ok(rules('src/a.ts', '// TODO gérer le cas vide').includes('warn:todo-orphan'));
    assert.deepEqual(rules('src/a.ts', '// TODO T-0042 gérer le cas vide'), [], 'TODO rattaché à une tâche');
    assert.ok(rules('app/api.py', 'rows = db.execute("SELECT * FROM orders")').includes('warn:select-star'));
    assert.ok(rules('src/a.ts', `const s = "${'x'.repeat(170)}";`).includes('warn:long-line'));
    assert.ok(rules('src/big.ts', 'export const a = 1;', 900).includes('warn:long-file'));
  });

  it('hors code (docs, migrations, générés) : ignoré', () => {
    assert.deepEqual(rules('README.md', 'console.log(x) // TODO'), []);
    assert.deepEqual(rules('supabase/migrations/001.sql', 'select * from t;'), []);
    assert.deepEqual(rules('lib/model.g.dart', 'print(x)'), []);
  });

  it('hook : silencieux si propre, avertit ou bloque sinon ; désactivable', () => {
    const dir = sandbox('web-shop');
    dirs.push(dir);
    assert.equal(cli(dir, ['init', '--yes']).code, 0);
    const file = path.join(dir, 'src', 'checked.ts');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const run = (content: string) => {
      fs.writeFileSync(file, content);
      const r = runtimeHook(dir, 'code-check', { session_id: 'cc', cwd: dir, tool_name: 'Write', tool_input: { file_path: file, content } });
      return r.stdout ? (JSON.parse(r.stdout) as { decision?: string; hookSpecificOutput?: { additionalContext?: string } }) : {};
    };
    assert.deepEqual(run('export const ok = 1;\n'), {});
    assert.match(run('console.log(1)\n').hookSpecificOutput?.additionalContext ?? '', /debug-leftover/);
    assert.equal(run('const q = `DELETE FROM t WHERE id = ${id}`;\n').decision, 'block');
  });
});
