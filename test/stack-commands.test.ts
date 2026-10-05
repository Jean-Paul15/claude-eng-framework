import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { diffCommands, hasChanges, mergedCommands } from '../src/app/commands-config.js';
import { createScanContext } from '../src/discovery/context.js';
import { chain } from '../src/discovery/app-stacks.js';
import { detectCommands } from '../src/discovery/quality.js';
import { detectPackageManagers } from '../src/discovery/stack.js';
import { cli, json, rm, sandbox } from './helpers.js';

/**
 * Gates déduites de la VRAIE pile du projet : app Flutter dans son dossier (`app/`), fonctions Deno de Supabase,
 * sans commandes Gradle qui ne disent rien de l'app Flutter. Seules des commandes dont l'existence est prouvée.
 */
const dirs: string[] = [];
after(() => dirs.forEach(rm));

const FLUTTER_PUBSPEC = 'name: app\nenvironment:\n  sdk: ">=3.5.0 <4.0.0"\ndependencies:\n  flutter:\n    sdk: flutter\n  supabase_flutter: ^2.0.0\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n';
const DART_PUBSPEC = 'name: tool\nenvironment:\n  sdk: ">=3.5.0 <4.0.0"\ndependencies:\n  args: ^2.0.0\ndev_dependencies:\n  test: ^1.0.0\n';

function commandsOf(files: Record<string, string>) {
  const ctx = createScanContext(Object.keys(files), (rel) => files[rel]);
  return detectCommands(ctx, detectPackageManagers(ctx));
}

const STEKO_LIKE: Record<string, string> = {
  'app/pubspec.yaml': FLUTTER_PUBSPEC,
  'app/lib/main.dart': 'void main() {}',
  'app/test/widget_test.dart': 'void main() {}',
  'app/android/build.gradle': "plugins { id 'com.android.application' }",
  'app/android/app/build.gradle': "plugins { id 'com.android.application' }",
  'app/ios/Podfile': '',
  'supabase/functions/deno.json': '{}',
  'supabase/functions/_shared/email/templates_test.ts': 'Deno.test("x", () => {});',
  'supabase/functions/ask/index.ts': 'Deno.serve(() => new Response("ok"));',
};

describe('app Flutter dans un sous-dossier', () => {
  it('build/unit/lint réels, lancés depuis le dossier de l\'app (jamais `gradle`)', () => {
    const c = commandsOf({ ...STEKO_LIKE });
    assert.equal(c.build, 'cd app && flutter build apk --debug');
    assert.equal(c.lint, 'cd app && flutter analyze');
    assert.equal(c.typecheck, 'cd app && flutter analyze');
    assert.equal(c.install, 'cd app && flutter pub get');
    assert.ok(!Object.values(c).some((v) => /gradle/.test(v ?? '')), 'les commandes Gradle du dossier android/ de l\'app ne sont pas proposées');
  });

  it('fonctions Deno de Supabase : `deno test --allow-all` depuis supabase/functions, enchaîné aux tests Flutter', () => {
    const c = commandsOf({ ...STEKO_LIKE });
    assert.equal(c.unit, 'cd app && flutter test && cd ../supabase/functions && deno test --allow-all');
  });

  it('Deno seul : `cd supabase/functions && deno test --allow-all`', () => {
    const c = commandsOf({ 'supabase/functions/deno.json': '{}', 'supabase/functions/x_test.ts': '' });
    assert.equal(c.unit, 'cd supabase/functions && deno test --allow-all');
  });

  it('pas de test Deno : pas de commande (`deno test` échouerait sans test)', () => {
    const files = { ...STEKO_LIKE };
    delete files['supabase/functions/_shared/email/templates_test.ts'];
    assert.equal(commandsOf(files).unit, 'cd app && flutter test');
  });

  it('app à la racine : sans préfixe ; tests d\'intégration seulement s\'ils existent', () => {
    const c = commandsOf({ 'pubspec.yaml': FLUTTER_PUBSPEC, 'lib/main.dart': '', 'integration_test/app_test.dart': '' });
    assert.equal(c.unit, 'flutter test');
    assert.equal(c.lint, 'flutter analyze');
    assert.equal(c.build, 'flutter build apk --debug');
    assert.equal(c.e2e, 'flutter test integration_test');
    assert.equal(commandsOf({ 'pubspec.yaml': FLUTTER_PUBSPEC }).e2e, undefined);
  });

  it('app iOS seule : pas de build APK', () => {
    assert.equal(commandsOf({ 'app/pubspec.yaml': FLUTTER_PUBSPEC, 'app/ios/Podfile': '' }).build, undefined);
  });

  it('projet Dart sans Flutter : dart analyze / dart test, pas de build APK', () => {
    const c = commandsOf({ 'tool/pubspec.yaml': DART_PUBSPEC, 'tool/lib/a.dart': '' });
    assert.equal(c.lint, 'cd tool && dart analyze');
    assert.equal(c.unit, 'cd tool && dart test');
    assert.equal(c.build, undefined);
  });

  it('le pubspec Flutter le plus proche de la racine l\'emporte', () => {
    const c = commandsOf({ 'app/pubspec.yaml': FLUTTER_PUBSPEC, 'app/packages/x/pubspec.yaml': FLUTTER_PUBSPEC, 'tools/pubspec.yaml': DART_PUBSPEC });
    assert.equal(c.unit, 'cd app && flutter test');
  });

  it('projet Android natif (Gradle sans Flutter) : inchangé', () => {
    const c = commandsOf({ 'build.gradle': "plugins { id 'com.android.application' }", 'gradlew': '' });
    assert.equal(c.build, './gradlew assemble');
    assert.equal(c.unit, './gradlew test');
  });

  it('le gestionnaire flutter est reconnu même quand pubspec.yaml n\'est pas à la racine', () => {
    const ctx = createScanContext(Object.keys(STEKO_LIKE), (rel) => STEKO_LIKE[rel]);
    assert.ok(detectPackageManagers(ctx).includes('flutter'));
  });

  it('enchaînement : `cd` relatif depuis le dossier courant, guillemets si besoin', () => {
    assert.equal(chain([{ dir: '', command: 'npm test' }, { dir: 'app', command: 'flutter test' }, { dir: 'supabase/functions', command: 'deno test --allow-all' }]), 'npm test && cd app && flutter test && cd ../supabase/functions && deno test --allow-all');
    assert.equal(chain([{ dir: 'mon app', command: 'flutter test' }]), 'cd "mon app" && flutter test');
  });
});

describe('ceng config detect', () => {
  it('diff : nouvelle, modifiée, inchangée, conservée', () => {
    const rows = diffCommands({ build: 'gradle assemble', unit: 'npm test', dev: 'npm run dev' }, { build: 'cd app && flutter build apk --debug', unit: 'npm test', lint: 'cd app && flutter analyze' });
    assert.deepEqual(rows.map((r) => [r.gate, r.change]), [['build', 'changed'], ['lint', 'added'], ['unit', 'unchanged'], ['dev', 'kept']]);
    assert.ok(hasChanges(rows));
    assert.ok(!hasChanges(diffCommands({ unit: 'a' }, { unit: 'a' })));
    assert.deepEqual(mergedCommands({ build: 'old', dev: 'npm run dev' }, { build: 'new' }), { build: 'new', dev: 'npm run dev' });
  });

  /** Projet Flutter dans app/ + fonctions Deno, initialisé avec les anciennes commandes Gradle. */
  function steko(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ceng-steko-'));
    dirs.push(dir);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    for (const [rel, content] of Object.entries(STEKO_LIKE)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    assert.equal(cli(dir, ['init', '--yes']).code, 0);
    return dir;
  }
  /** Configuration d'un projet initialisé avant ces gates : commandes Gradle héritées. */
  const makeStale = (dir: string): void => {
    const file = path.join(dir, '.ceng', 'config.json');
    const stale = JSON.parse(fs.readFileSync(file, 'utf8')) as { commands: Record<string, string> };
    stale.commands = { build: 'gradle assemble', unit: 'gradle test', lint: 'gradle check -x test', contract: 'ma-commande-perso' };
    fs.writeFileSync(file, JSON.stringify(stale, null, 2));
  };
  const configOf = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, '.ceng', 'config.json'), 'utf8')) as { commands: Record<string, string> };

  it('affiche la configuration recommandée sans rien écrire', () => {
    const dir = steko();
    makeStale(dir);
    const config = path.join(dir, '.ceng', 'config.json');
    const before = fs.readFileSync(config, 'utf8');
    const r = cli(dir, ['config', 'detect']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /flutter build apk --debug/);
    assert.match(r.stdout, /deno test --allow-all/);
    assert.match(r.stdout, /config detect --apply/);
    assert.equal(fs.readFileSync(config, 'utf8'), before);
    const machine = json<{ applied: boolean; commands: Record<string, string> }>(cli(dir, ['config', 'detect', '--json']));
    assert.equal(machine.applied, false);
    assert.equal(machine.commands.lint, 'cd app && flutter analyze');
  });

  it('--apply remplace les anciennes commandes (Gradle) par les recommandées et conserve celles que la détection ne propose pas', () => {
    const dir = steko();
    makeStale(dir);
    const r = cli(dir, ['config', 'detect', '--apply']);
    assert.equal(r.code, 0, r.stderr);
    const c = configOf(dir).commands;
    assert.equal(c['build'], 'cd app && flutter build apk --debug');
    assert.equal(c['lint'], 'cd app && flutter analyze');
    assert.equal(c['unit'], 'cd app && flutter test && cd ../supabase/functions && deno test --allow-all');
    assert.equal(c['contract'], 'ma-commande-perso', 'commande ajoutée à la main : conservée');
    assert.match(cli(dir, ['config', 'detect']).stdout, /déjà à jour/);
  });

  it('--apply sans projet initialisé : refus clair', () => {
    const dir = sandbox('ts-library');
    dirs.push(dir);
    const r = cli(dir, ['config', 'detect', '--apply']);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /non initialisé/);
  });

  it('sous-commande inconnue : usage', () => {
    const dir = sandbox('ts-library');
    dirs.push(dir);
    assert.equal(cli(dir, ['config', 'nope']).code, 2);
  });
});
