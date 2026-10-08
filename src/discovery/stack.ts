import { pubspecFiles } from './app-stacks.js';
import { anyFile, hasAny, matching, type ScanContext } from './context.js';
import type { ProjectProfile, ProjectType } from './profile.js';

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', ipynb: 'Python', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', kts: 'Kotlin',
  swift: 'Swift', dart: 'Dart', rb: 'Ruby', php: 'PHP', cs: 'C#', fs: 'F#', scala: 'Scala',
  c: 'C', h: 'C', cpp: 'C++', cc: 'C++', hpp: 'C++', ex: 'Elixir', exs: 'Elixir', clj: 'Clojure',
  sql: 'SQL', tf: 'HCL', vue: 'Vue', svelte: 'Svelte', lua: 'Lua', r: 'R', jl: 'Julia', zig: 'Zig', sh: 'Shell',
};
/** Langages « d'appoint » qui ne doivent pas devenir le langage principal. */
const SECONDARY = new Set(['SQL', 'Shell', 'HCL']);

export function detectLanguages(ctx: ScanContext): Pick<ProjectProfile, 'languages' | 'primaryLanguage'> {
  const counts = new Map<string, number>();
  for (const f of ctx.files) {
    const ext = f.slice(f.lastIndexOf('.') + 1).toLowerCase();
    const lang = LANGUAGE_BY_EXT[ext];
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  const languages = [...counts.entries()].map(([name, files]) => ({ name, files })).sort((a, b) => b.files - a.files);
  const primary = languages.find((l) => !SECONDARY.has(l.name))?.name ?? languages[0]?.name;
  return { languages, ...(primary ? { primaryLanguage: primary } : {}) };
}

export function detectPackageManagers(ctx: ScanContext): string[] {
  const pm: string[] = [];
  const add = (cond: unknown, name: string) => cond && !pm.includes(name) && pm.push(name);
  add(ctx.has('pnpm-lock.yaml'), 'pnpm');
  add(ctx.has('yarn.lock'), 'yarn');
  add(ctx.has('bun.lockb') || ctx.has('bun.lock'), 'bun');
  add(ctx.has('package-lock.json') || (ctx.has('package.json') && pm.length === 0), 'npm');
  add(ctx.has('uv.lock'), 'uv');
  add(ctx.has('poetry.lock'), 'poetry');
  add(ctx.has('Pipfile.lock') || ctx.has('Pipfile'), 'pipenv');
  // Python à la RACINE seulement : un sous-dossier Python (outils, `ml/`) d'un projet d'une autre pile ne fait pas lancer
  // `pytest` depuis la racine.
  add(ctx.files.some((f) => /^requirements[\w.-]*\.txt$/.test(f)) || (ctx.has('pyproject.toml') && !pm.some((p) => ['uv', 'poetry', 'pipenv'].includes(p))), 'pip');
  add(ctx.has('go.mod'), 'go');
  add(ctx.has('Cargo.toml'), 'cargo');
  add(pubspecFiles(ctx).length > 0, ctx.deps.has('flutter') ? 'flutter' : 'dart');
  add(ctx.has('pom.xml'), 'maven');
  add(ctx.byName(/^build\.gradle(\.kts)?$/).length > 0, 'gradle');
  add(ctx.has('Gemfile'), 'bundler');
  add(ctx.has('composer.json'), 'composer');
  add(ctx.byName(/\.(csproj|sln)$/).length > 0, 'dotnet');
  add(ctx.has('mix.exs'), 'mix');
  add(ctx.has('Podfile'), 'cocoapods');
  return pm;
}

const FRONTEND = ['next', 'nuxt', 'react', 'vue', 'svelte', '@sveltejs/kit', '@angular/core', '@remix-run/react', 'astro', 'solid-js', 'preact', 'gatsby', '@builder.io/qwik', 'lit'];
const BACKEND_NODE = ['express', 'fastify', '@nestjs/core', 'koa', 'hono', '@hapi/hapi', 'apollo-server', '@apollo/server', 'graphql-yoga', 'trpc', '@trpc/server', 'elysia'];
const BACKEND_PY = ['fastapi', 'flask', 'django', 'djangorestframework', 'starlette', 'litestar', 'sanic', 'aiohttp', 'tornado'];
const BACKEND_OTHER = ['github.com/gin-gonic/gin', 'github.com/labstack/echo/v4', 'github.com/gofiber/fiber/v2', 'github.com/go-chi/chi/v5', 'actix-web', 'axum', 'rocket', 'rails', 'sinatra', 'laravel/framework', 'symfony/framework-bundle', 'spring-boot-starter-web', 'spring-boot-starter-webflux', 'microsoft.aspnetcore.openapi', 'phoenix', 'ktor-server-core'];
const MOBILE = ['flutter', 'react-native', 'expo', '@capacitor/core', '@ionic/angular', 'android-gradle'];
const DATA = ['pandas', 'polars', 'pyspark', 'dbt-core', 'apache-airflow', 'dagster', 'prefect', 'great-expectations', 'duckdb', 'apache-beam', 'luigi', 'kedro', 'sqlmesh'];
const ML = ['torch', 'tensorflow', 'scikit-learn', 'transformers', 'keras', 'xgboost', 'lightgbm', 'jax', 'mlflow'];
const CLI = ['commander', 'yargs', 'oclif', '@oclif/core', 'click', 'typer', 'github.com/spf13/cobra', 'clap', 'cac', 'citty'];
const DESKTOP = ['electron', '@tauri-apps/api', 'tauri'];

export function detectFrameworks(ctx: ScanContext): string[] {
  const found = matching(ctx, [...FRONTEND, ...BACKEND_NODE, ...BACKEND_PY, ...BACKEND_OTHER, ...MOBILE, ...DATA, ...ML, ...CLI, ...DESKTOP, 'vite', 'tailwindcss', 'prisma', 'drizzle-orm']);
  if (ctx.has('dbt_project.yml') && !found.includes('dbt-core')) found.push('dbt-core');
  if (anyFile(ctx, /(^|\/)dags\/.*\.py$/) && !found.includes('apache-airflow')) found.push('apache-airflow');
  if (ctx.byName(/\.xcodeproj$/).length > 0 || anyFile(ctx, /\.xcodeproj\//)) found.push('xcode');
  if (ctx.has('manage.py') && !found.includes('django')) found.push('django');
  if (ctx.has('Gemfile') && ctx.has('config/routes.rb') && !found.includes('rails')) found.push('rails');
  return found;
}

export function detectUi(ctx: ScanContext, frameworks: readonly string[]): boolean {
  if (frameworks.some((f) => FRONTEND.includes(f) || MOBILE.includes(f) || DESKTOP.includes(f))) return true;
  if (frameworks.includes('xcode')) return true;
  return ctx.files.some((f) => /\.(html|css|scss|vue|svelte|tsx|jsx)$/.test(f) && !f.includes('test'));
}

export function detectProjectTypes(ctx: ScanContext, frameworks: readonly string[]): ProjectType[] {
  const types: ProjectType[] = [];
  const add = (cond: unknown, t: ProjectType) => cond && !types.includes(t) && types.push(t);
  const fw = (list: readonly string[]) => frameworks.some((f) => list.includes(f));
  add(fw(MOBILE) || frameworks.includes('xcode'), 'mobile');
  add(fw(FRONTEND) || frameworks.includes('django') || frameworks.includes('rails') || (frameworks.includes('vite') && ctx.has('index.html')), 'web-app');
  add(fw(BACKEND_NODE) || fw(BACKEND_PY.filter((f) => f !== 'django')) || fw(BACKEND_OTHER) || anyFile(ctx, /(^|\/)(openapi|swagger)\.(ya?ml|json)$/), 'api');
  add(fw(DATA) || ctx.files.filter((f) => f.endsWith('.ipynb')).length >= 2, 'data');
  add(fw(ML), 'ml');
  add(fw(DESKTOP), 'desktop');
  const pkgBin = ctx.packageJson?.bin !== undefined;
  add(pkgBin || fw(CLI) || anyFile(ctx, /^cmd\/[^/]+\/main\.go$/), 'cli');
  const infraOnly = ctx.files.length > 0 && ctx.files.filter((f) => f.endsWith('.tf')).length > ctx.files.length / 3;
  add(infraOnly, 'infra');
  if (types.length === 0) {
    const isLib = (ctx.packageJson && (ctx.packageJson.main || ctx.packageJson.exports) && !ctx.packageJson.private) || ctx.has('setup.py') || (ctx.has('pyproject.toml') && /\[build-system\]/.test(ctx.read('pyproject.toml') ?? '')) || ctx.has('Cargo.toml');
    add(isLib, 'library');
  }
  if (types.length === 0) types.push('unknown');
  return types;
}

export function detectArchitecture(ctx: ScanContext): ProjectProfile['architecture'] {
  const pkg = ctx.packageJson;
  const ws = Array.isArray(pkg?.workspaces) ? pkg.workspaces : pkg?.workspaces?.packages ?? [];
  const workspaces = [...ws];
  const pnpmWs = ctx.read('pnpm-workspace.yaml');
  if (pnpmWs) for (const m of pnpmWs.matchAll(/^\s*-\s*['"]?([^'"\n]+)['"]?/gm)) workspaces.push(m[1]!.trim());
  const monorepo = workspaces.length > 0 || ctx.has('turbo.json') || ctx.has('nx.json') || ctx.has('lerna.json') || ctx.has('go.work') || /\[workspace\]/.test(ctx.read('Cargo.toml') ?? '');
  const topLevelDirs = [...new Set(ctx.files.filter((f) => f.includes('/')).map((f) => f.split('/')[0]!))].sort();
  const dirs = new Set(ctx.files.flatMap((f) => f.split('/').slice(0, -1)));
  const styles: string[] = [];
  if (monorepo) styles.push('monorepo');
  if (['domain', 'application', 'infrastructure'].filter((d) => dirs.has(d)).length >= 2) styles.push('clean/hexagonal layers');
  if (dirs.has('features') || dirs.has('modules')) styles.push('feature modules');
  if (['controllers', 'models', 'views'].filter((d) => dirs.has(d)).length >= 2) styles.push('MVC');
  if (dirs.has('services') && (ctx.has('docker-compose.yml') || ctx.has('compose.yaml')) && ctx.byName('Dockerfile').length > 1) styles.push('multi-service');
  if (ctx.files.some((f) => f.startsWith('app/') && /\/(page|layout)\.(t|j)sx?$/.test(f))) styles.push('Next.js app router');
  if (hasAny(ctx, ['@nestjs/core'])) styles.push('NestJS modules');
  if (ctx.has('dbt_project.yml')) styles.push('dbt models (staging → marts)');
  return { monorepo, workspaces, styles, topLevelDirs };
}
