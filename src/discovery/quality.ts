import { anyFile, hasAny, matching, type ScanContext } from './context.js';
import type { Commands, ProjectProfile } from './profile.js';

export function detectTesting(ctx: ScanContext): ProjectProfile['testing'] {
  const frameworks = matching(ctx, ['jest', 'vitest', 'mocha', 'ava', 'jasmine', 'pytest', 'hypothesis', 'fast-check', 'rspec', 'minitest', 'phpunit/phpunit', 'junit', 'junit-jupiter', 'kotest', 'xunit', 'nunit', 'flutter_test', 'mockito', 'testify', 'proptest', 'quickcheck', '@pact-foundation/pact', 'pact-python', 'stryker', '@stryker-mutator/core', 'mutmut', 'supertest', '@testing-library/react']);
  if (ctx.has('pytest.ini') || ctx.byName('conftest.py').length > 0 || /\[tool\.pytest/.test(ctx.read('pyproject.toml') ?? '')) if (!frameworks.includes('pytest')) frameworks.push('pytest');
  if (ctx.files.some((f) => f.endsWith('_test.go'))) frameworks.push('go test');
  if (ctx.has('Cargo.toml') && ctx.files.some((f) => f.endsWith('.rs'))) frameworks.push('cargo test');
  const e2e = matching(ctx, ['@playwright/test', 'playwright', 'cypress', 'puppeteer', 'webdriverio', 'detox', 'integration_test', 'selenium', 'maestro']);
  if (ctx.files.some((f) => f.startsWith('.maestro/'))) e2e.push('maestro');
  const testFiles = ctx.files.filter((f) => /(^|\/)(tests?|__tests__|spec|integration_test)\/|[._-](test|spec)\.[a-z]+$|_test\.(go|dart|py)$|^test_.*\.py$|\/test_[^/]+\.py$/.test(f)).length;
  return { frameworks: [...new Set(frameworks)], e2e: [...new Set(e2e)], testFiles, hasTests: testFiles > 0 };
}

export function detectCi(ctx: ScanContext): ProjectProfile['ci'] {
  const providers: string[] = [];
  const files: string[] = [];
  const gh = ctx.files.filter((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f));
  if (gh.length) providers.push('github-actions'), files.push(...gh);
  const check = (file: string, name: string) => ctx.has(file) && (providers.push(name), files.push(file));
  check('.gitlab-ci.yml', 'gitlab-ci');
  check('azure-pipelines.yml', 'azure-pipelines');
  check('Jenkinsfile', 'jenkins');
  check('bitbucket-pipelines.yml', 'bitbucket');
  check('.circleci/config.yml', 'circleci');
  check('codemagic.yaml', 'codemagic');
  check('.travis.yml', 'travis');
  return { providers, files };
}

export function detectConventions(ctx: ScanContext): ProjectProfile['conventions'] {
  const linters = matching(ctx, ['eslint', '@biomejs/biome', 'ruff', 'flake8', 'pylint', 'rubocop', 'golangci-lint', 'stylelint', 'squizlabs/php_codesniffer', 'detekt', 'ktlint', 'oxlint']);
  if (ctx.files.some((f) => /^\.?eslint(rc)?(\.|$)|^eslint\.config\./.test(f)) && !linters.includes('eslint')) linters.push('eslint');
  if (ctx.has('analysis_options.yaml')) linters.push('dart analyze');
  if (ctx.has('.golangci.yml') || ctx.has('.golangci.yaml')) linters.push('golangci-lint');
  if (/\[tool\.ruff/.test(ctx.read('pyproject.toml') ?? '') || ctx.has('ruff.toml')) if (!linters.includes('ruff')) linters.push('ruff');
  if (ctx.has('Cargo.toml')) linters.push('clippy');
  const formatters = matching(ctx, ['prettier', 'black', 'ruff', '@biomejs/biome', 'gofumpt']);
  if (ctx.files.some((f) => /^\.prettierrc/.test(f)) && !formatters.includes('prettier')) formatters.push('prettier');
  const typeCheckers = matching(ctx, ['typescript', 'mypy', 'pyright', 'flow-bin']);
  const tsconfig = ctx.read('tsconfig.json') ?? '';
  return {
    linters: [...new Set(linters)],
    formatters: [...new Set(formatters)],
    typeCheckers,
    editorconfig: ctx.has('.editorconfig'),
    strictTypes: /"strict"\s*:\s*true/.test(tsconfig) || /strict\s*=\s*true/.test(ctx.read('mypy.ini') ?? ctx.read('pyproject.toml') ?? ''),
  };
}

/** Préfixe d'exécution selon le gestionnaire (npm test → `npm test`, sinon `<pm> run <script>`). */
function nodeRunner(pm: string, script: string): string {
  if (pm === 'npm') return script === 'test' ? 'npm test' : `npm run ${script}`;
  if (pm === 'bun') return `bun run ${script}`;
  return `${pm} ${script}`;
}

function pyRunner(pms: readonly string[]): string {
  if (pms.includes('uv')) return 'uv run ';
  if (pms.includes('poetry')) return 'poetry run ';
  if (pms.includes('pipenv')) return 'pipenv run ';
  return '';
}

/**
 * Commandes réelles du projet, associées aux gates. On ne propose qu'une commande dont l'existence
 * est prouvée (script déclaré, dépendance présente, fichier de config) — jamais une supposition.
 */
export function detectCommands(ctx: ScanContext, packageManagers: readonly string[]): Commands {
  const c: Commands = {};
  const set = (key: keyof Commands, value: string | undefined) => {
    if (value && !c[key]) c[key] = value;
  };
  const scripts = ctx.packageJson?.scripts ?? {};
  const nodePm = ['pnpm', 'yarn', 'bun', 'npm'].find((p) => packageManagers.includes(p));
  if (nodePm) {
    const pick = (...names: string[]) => names.find((n) => scripts[n]);
    set('install', nodePm === 'npm' ? (ctx.has('package-lock.json') ? 'npm ci' : 'npm install') : `${nodePm} install`);
    const s = (key: keyof Commands, ...names: string[]) => {
      const name = pick(...names);
      if (name) set(key, nodeRunner(nodePm, name));
    };
    s('build', 'build');
    s('typecheck', 'typecheck', 'type-check', 'check-types', 'tsc', 'types');
    s('lint', 'lint');
    s('format', 'format:check', 'prettier:check', 'fmt:check');
    s('unit', 'test:unit', 'test');
    s('integration', 'test:integration', 'test:int', 'test:e2e:api');
    s('e2e', 'test:e2e', 'e2e', 'cypress:run', 'playwright');
    s('contract', 'test:contract', 'pact');
    s('migration', 'db:migrate:check', 'migrate:check');
    s('performance', 'bench', 'perf');
    s('dev', 'dev', 'start');
    if (!c.typecheck && ctx.deps.has('typescript') && ctx.has('tsconfig.json')) set('typecheck', 'npx tsc --noEmit');
    if (!c.e2e && ctx.deps.has('@playwright/test')) set('e2e', 'npx playwright test');
    if (nodePm === 'npm' || nodePm === 'pnpm') set('deps-audit', `${nodePm} audit --audit-level=high`);
    if (nodePm === 'yarn') set('deps-audit', 'yarn npm audit --severity high');
    if (ctx.deps.has('prisma')) set('migration', 'npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code --shadow-database-url "$SHADOW_DATABASE_URL"');
  }

  const isPython = packageManagers.some((p) => ['uv', 'poetry', 'pipenv', 'pip'].includes(p));
  if (isPython) {
    const r = pyRunner(packageManagers);
    if (packageManagers.includes('uv')) set('install', 'uv sync');
    else if (packageManagers.includes('poetry')) set('install', 'poetry install');
    else if (ctx.has('requirements.txt')) set('install', 'pip install -r requirements.txt');
    const pytest = ctx.deps.has('pytest') || ctx.has('pytest.ini') || ctx.byName('conftest.py').length > 0 || /\[tool\.pytest/.test(ctx.read('pyproject.toml') ?? '');
    if (pytest) {
      set('unit', `${r}pytest -q`);
      if (ctx.files.some((f) => /(^|\/)tests\/integration\//.test(f))) set('integration', `${r}pytest -q tests/integration`);
    }
    if (ctx.deps.has('ruff') || ctx.has('ruff.toml') || /\[tool\.ruff/.test(ctx.read('pyproject.toml') ?? '')) {
      set('lint', `${r}ruff check .`);
      set('format', `${r}ruff format --check .`);
    } else if (ctx.deps.has('flake8')) set('lint', `${r}flake8`);
    if (ctx.deps.has('black')) set('format', `${r}black --check .`);
    if (ctx.deps.has('mypy')) set('typecheck', `${r}mypy .`);
    else if (ctx.deps.has('pyright')) set('typecheck', `${r}pyright`);
    if (ctx.deps.has('pip-audit')) set('deps-audit', `${r}pip-audit`);
    if (ctx.deps.has('alembic')) set('migration', `${r}alembic check`);
    if (ctx.has('manage.py')) set('migration', `${r}python manage.py makemigrations --check --dry-run`);
    if (ctx.has('dbt_project.yml')) {
      set('build', 'dbt build');
      set('integration', 'dbt test');
    }
  }
  if (packageManagers.includes('go')) {
    set('build', 'go build ./...');
    set('unit', 'go test ./...');
    set('lint', ctx.has('.golangci.yml') || ctx.has('.golangci.yaml') ? 'golangci-lint run' : 'go vet ./...');
    set('deps-audit', 'govulncheck ./...');
  }
  if (packageManagers.includes('cargo')) {
    set('build', 'cargo build');
    set('unit', 'cargo test');
    set('lint', 'cargo clippy -- -D warnings');
    set('format', 'cargo fmt --check');
    set('deps-audit', 'cargo audit');
  }
  if (packageManagers.includes('flutter') || packageManagers.includes('dart')) {
    const tool = packageManagers.includes('flutter') ? 'flutter' : 'dart';
    set('install', `${tool} pub get`);
    set('lint', `${tool} analyze`);
    set('typecheck', `${tool} analyze`);
    set('unit', `${tool} test`);
    set('format', 'dart format --output=none --set-exit-if-changed .');
    if (ctx.files.some((f) => f.startsWith('integration_test/'))) set('e2e', 'flutter test integration_test');
  }
  if (packageManagers.includes('maven')) {
    set('build', 'mvn -q -DskipTests package');
    set('unit', 'mvn -q test');
    set('integration', 'mvn -q verify');
  }
  if (packageManagers.includes('gradle')) {
    const g = ctx.has('gradlew') ? './gradlew' : 'gradle';
    set('build', `${g} assemble`);
    set('unit', `${g} test`);
    set('lint', `${g} check -x test`);
  }
  if (packageManagers.includes('bundler')) {
    set('unit', ctx.deps.has('rspec') || ctx.deps.has('rspec-rails') ? 'bundle exec rspec' : 'bundle exec rake test');
    if (ctx.deps.has('rubocop')) set('lint', 'bundle exec rubocop');
    if (ctx.deps.has('bundler-audit')) set('deps-audit', 'bundle exec bundle-audit check --update');
  }
  if (packageManagers.includes('composer')) {
    set('unit', 'vendor/bin/phpunit');
    if (ctx.deps.has('phpstan/phpstan')) set('typecheck', 'vendor/bin/phpstan analyse');
    set('deps-audit', 'composer audit');
  }
  if (packageManagers.includes('dotnet')) {
    set('build', 'dotnet build');
    set('unit', 'dotnet test');
    set('deps-audit', 'dotnet list package --vulnerable');
  }
  // Makefile : uniquement en repli, si des cibles existent réellement.
  const make = ctx.read('Makefile');
  if (make) {
    for (const [key, target] of [['build', 'build'], ['unit', 'test'], ['lint', 'lint']] as const) {
      if (new RegExp(`^${target}:`, 'm').test(make)) set(key, `make ${target}`);
    }
  }
  if (!c.unit && anyFile(ctx, /(^|\/)test\/.*\.test\.(m?js|ts)$/) && hasAny(ctx, ['typescript']) === false && nodePm) set('unit', 'node --test');
  return c;
}
