import * as path from 'node:path';
import type { ScanContext } from './context.js';
import type { Commands } from './profile.js';

/**
 * Applications qui ne sont pas à la racine du dépôt : app Dart/Flutter (`app/`), fonctions Deno de Supabase
 * (`supabase/functions/`). Les commandes de gates se lancent depuis la racine : elles sont donc préfixées par `cd <dossier>`.
 * Chaque commande n'est proposée que si l'existence de ce qu'elle lance est prouvée par les fichiers du dépôt.
 */

const MANIFEST_DEPTH = 3;
const DENO_DIR = 'supabase/functions';
/** Fichiers que `deno test` découvre : `x_test.ts`, `x.test.ts`, `test.ts` (sans test, `deno test` échoue). */
const DENO_TEST_FILE = /(^|\/)([^/]*[._]test|test)\.(m?[jt]sx?)$/;

export interface DartApp {
  /** Dossier relatif à la racine du dépôt ('' : la racine). */
  dir: string;
  flutter: boolean;
  hasAndroid: boolean;
  hasIos: boolean;
}

const dirOf = (file: string): string => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');
const under = (dir: string, rel: string): string => (dir ? `${dir}/${rel}` : rel);

/** Manifestes pubspec.yaml du dépôt (assez près de la racine pour être une application, pas une dépendance vendue). */
export function pubspecFiles(ctx: ScanContext): string[] {
  return ctx.byName('pubspec.yaml').filter((f) => f.split('/').length - 1 <= MANIFEST_DEPTH);
}

/** L'application Dart/Flutter à outiller : Flutter avant Dart, la plus proche de la racine d'abord. */
export function findDartApp(ctx: ScanContext): DartApp | undefined {
  const candidates = pubspecFiles(ctx)
    .map((file) => ({ dir: dirOf(file), flutter: /sdk:\s*flutter/.test(ctx.read(file) ?? '') }))
    .sort((a, b) => Number(b.flutter) - Number(a.flutter) || a.dir.split('/').length - b.dir.split('/').length || a.dir.localeCompare(b.dir));
  const best = candidates[0];
  if (!best) return undefined;
  return {
    ...best,
    hasAndroid: ctx.files.some((f) => f.startsWith(under(best.dir, 'android/'))),
    hasIos: ctx.files.some((f) => f.startsWith(under(best.dir, 'ios/'))),
  };
}

/** Dossier des fonctions Deno de Supabase, seulement s'il contient de vrais tests. */
export function findDenoFunctions(ctx: ScanContext): string | undefined {
  return ctx.files.some((f) => f.startsWith(`${DENO_DIR}/`) && DENO_TEST_FILE.test(f)) ? DENO_DIR : undefined;
}

// ---------------------------------------------------------------- Commandes

export interface Step {
  dir: string;
  command: string;
}

const quote = (p: string): string => (/^[\w./-]+$/.test(p) ? p : `"${p}"`);

/** Enchaîne des commandes lancées depuis des dossiers différents (`cd` relatif depuis le dossier courant). */
export function chain(steps: readonly Step[]): string {
  const parts: string[] = [];
  let cwd = '';
  for (const step of steps) {
    if (step.dir !== cwd) {
      parts.push(`cd ${quote(path.posix.relative(`/${cwd}`, `/${step.dir}`))}`);
      cwd = step.dir;
    }
    parts.push(step.command);
  }
  return parts.join(' && ');
}

/** Commandes de l'application Dart/Flutter (outil et dossier réels), hors tests unitaires : voir `dartUnitStep`. */
export function dartCommands(app: DartApp, hasIntegrationTests: boolean): Commands {
  const tool = app.flutter ? 'flutter' : 'dart';
  const at = (command: string): string => chain([{ dir: app.dir, command }]);
  const c: Commands = {
    install: at(`${tool} pub get`),
    lint: at(`${tool} analyze`),
    typecheck: at(`${tool} analyze`),
    format: at('dart format --output=none --set-exit-if-changed .'),
  };
  // L'APK de debug exige le dossier android/ ; une app iOS seule n'a pas de build vérifiable depuis toutes les machines.
  if (app.flutter && (app.hasAndroid || !app.hasIos)) c.build = at('flutter build apk --debug');
  if (app.flutter && hasIntegrationTests) c.e2e = at('flutter test integration_test');
  return c;
}

/** Tests de l'app Dart/Flutter, à enchaîner avec ceux des autres piles : une seule gate `unit`. */
export function dartUnitStep(app: DartApp): Step {
  return { dir: app.dir, command: app.flutter ? 'flutter test' : 'dart test' };
}

export function denoUnitStep(dir: string): Step {
  return { dir, command: 'deno test --allow-all' };
}

export function hasIntegrationTests(ctx: ScanContext, app: DartApp): boolean {
  return ctx.files.some((f) => f.startsWith(under(app.dir, 'integration_test/')));
}
