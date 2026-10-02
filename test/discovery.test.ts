import { strict as assert } from 'node:assert';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { buildScanContext } from '../src/discovery/context.js';
import { profileFromContext } from '../src/discovery/index.js';
import { selectAssets, SKILLS } from '../src/generation/catalog.js';
import { EXAMPLES } from './helpers.js';

const noGit = { isRepo: false, remotes: [], commitConvention: 'unknown' as const, protectedBranches: ['main'], dirtyFiles: 0 };
const profile = (name: string) => profileFromContext(buildScanContext(path.join(EXAMPLES, name)), name, noGit);
const skills = (name: string) => selectAssets(SKILLS, profile(name)).selected.map((s) => s.name);

describe('découverte : le framework s\'adapte au projet', () => {
  it('application web (Next.js + Prisma + Stripe)', () => {
    const p = profile('web-shop');
    assert.ok(p.projectTypes.includes('web-app'));
    assert.equal(p.primaryLanguage, 'TypeScript');
    assert.ok(p.frameworks.includes('next'));
    assert.ok(p.ui);
    assert.deepEqual(p.databases, ['postgresql']);
    assert.ok(p.services.includes('stripe'));
    assert.ok(p.domains.some((d) => d.name === 'payments'));
    assert.equal(p.riskLevel, 'critical');
    assert.equal(p.commands.unit, 'npm test');
    assert.equal(p.commands.typecheck, 'npm run typecheck');
    assert.equal(p.commands.e2e, 'npm run test:e2e');
    assert.ok(p.ci.providers.includes('github-actions'));
    assert.ok(p.deployment.includes('vercel'));
    assert.ok(p.migrations.some((m) => m.tool === 'prisma'));
    assert.equal(p.legal.license, 'UNLICENSED');
  });

  it('API backend (FastAPI + Postgres + auth)', () => {
    const p = profile('api-backend');
    assert.ok(p.projectTypes.includes('api'));
    assert.ok(!p.ui);
    assert.equal(p.primaryLanguage, 'Python');
    assert.ok(p.frameworks.includes('fastapi'));
    assert.ok(p.packageManagers.includes('uv'));
    assert.equal(p.commands.unit, 'uv run pytest -q');
    assert.equal(p.commands.lint, 'uv run ruff check .');
    assert.equal(p.commands.typecheck, 'uv run mypy .');
    assert.ok(p.domains.some((d) => d.name === 'auth'));
    assert.equal(p.riskLevel, 'high');
    assert.ok(p.ci.providers.includes('gitlab-ci'));
    assert.ok(p.infra.includes('docker-compose'));
    assert.equal(p.legal.license, 'MIT');
  });

  it('projet data (dbt + Airflow + pandas)', () => {
    const p = profile('data-pipeline');
    assert.ok(p.projectTypes.includes('data'));
    assert.ok(p.frameworks.includes('dbt-core'));
    assert.ok(p.frameworks.includes('apache-airflow'));
    assert.equal(p.commands.build, 'dbt build');
    assert.ok(p.architecture.styles.some((s) => s.includes('dbt')));
  });

  it('projet mobile (Flutter + Firebase)', () => {
    const p = profile('mobile-app');
    assert.ok(p.projectTypes.includes('mobile'));
    assert.equal(p.primaryLanguage, 'Dart');
    assert.ok(p.packageManagers.includes('flutter'));
    assert.equal(p.commands.unit, 'flutter test');
    assert.equal(p.commands.e2e, 'flutter test integration_test');
    assert.ok(p.services.includes('firebase'));
    assert.ok(p.deployment.some((d) => d.includes('codemagic')));
  });

  it('bibliothèque TypeScript : faible risque, pas de surface UI ni serveur', () => {
    const p = profile('ts-library');
    assert.deepEqual(p.projectTypes, ['library']);
    assert.equal(p.riskLevel, 'low');
    assert.ok(!p.ui);
  });

  it('sélection de skills différente selon le contexte', () => {
    const web = skills('web-shop');
    const api = skills('api-backend');
    const lib = skills('ts-library');
    const mobile = skills('mobile-app');
    for (const s of ['frontend', 'accessibility', 'creative-director', 'frontend-executor', 'quality-gate-auditor', 'database']) assert.ok(web.includes(s), `web: ${s}`);
    for (const s of ['backend', 'api-design', 'database', 'threat-modeling']) assert.ok(api.includes(s), `api: ${s}`);
    assert.ok(!api.includes('frontend') && !api.includes('creative-director'));
    assert.ok(mobile.includes('creative-director') && mobile.includes('accessibility'));
    assert.ok(!lib.includes('frontend') && !lib.includes('database') && !lib.includes('backend'));
    for (const s of ['ceng-orchestrate', 'security', 'legal-governance', 'testing']) assert.ok(lib.includes(s), `toujours : ${s}`);
    assert.ok(lib.length < web.length, 'moins de skills = moins de contexte permanent');
  });
});
