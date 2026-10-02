import { anyFile, matching, type ScanContext } from './context.js';
import type { ProjectProfile } from './profile.js';

export function detectData(ctx: ScanContext): Pick<ProjectProfile, 'databases' | 'orm' | 'migrations'> {
  const databases = new Set<string>();
  const dbDeps: Record<string, string> = {
    pg: 'postgresql', postgres: 'postgresql', 'psycopg2': 'postgresql', 'psycopg2-binary': 'postgresql', psycopg: 'postgresql', asyncpg: 'postgresql', 'github.com/jackc/pgx/v5': 'postgresql', 'org.postgresql': 'postgresql', postgresql: 'postgresql',
    mysql: 'mysql', mysql2: 'mysql', pymysql: 'mysql', 'mysqlclient': 'mysql',
    mongodb: 'mongodb', mongoose: 'mongodb', pymongo: 'mongodb', motor: 'mongodb',
    redis: 'redis', ioredis: 'redis', 'redis-py': 'redis',
    sqlite3: 'sqlite', 'better-sqlite3': 'sqlite', sqflite: 'sqlite', drift: 'sqlite',
    '@supabase/supabase-js': 'postgresql', supabase: 'postgresql', supabase_flutter: 'postgresql',
    'cloud_firestore': 'firestore', 'firebase-admin': 'firestore', '@google-cloud/firestore': 'firestore',
    '@aws-sdk/client-dynamodb': 'dynamodb', boto3: 'aws', duckdb: 'duckdb', snowflake: 'snowflake', 'snowflake-connector-python': 'snowflake', 'google-cloud-bigquery': 'bigquery', 'dbt-postgres': 'postgresql', 'dbt-snowflake': 'snowflake', 'dbt-bigquery': 'bigquery', 'dbt-duckdb': 'duckdb', elasticsearch: 'elasticsearch', '@elastic/elasticsearch': 'elasticsearch', cassandra: 'cassandra', 'neo4j-driver': 'neo4j',
  };
  for (const [dep, db] of Object.entries(dbDeps)) if (ctx.deps.has(dep) && db !== 'aws') databases.add(db);
  const compose = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].map((f) => ctx.read(f) ?? '').join('\n');
  for (const [img, db] of [['postgres', 'postgresql'], ['mysql', 'mysql'], ['mariadb', 'mysql'], ['mongo', 'mongodb'], ['redis', 'redis'], ['elasticsearch', 'elasticsearch']] as const) {
    if (new RegExp(`image:\\s*['"]?${img}`, 'i').test(compose)) databases.add(db);
  }
  const prismaSchema = ctx.files.find((f) => f.endsWith('schema.prisma'));
  const provider = prismaSchema && ctx.read(prismaSchema)?.match(/provider\s*=\s*"(postgresql|mysql|sqlite|mongodb|sqlserver|cockroachdb)"/)?.[1];
  if (provider) databases.add(provider);
  const orm = matching(ctx, ['prisma', '@prisma/client', 'drizzle-orm', 'typeorm', 'sequelize', 'mikro-orm', 'knex', 'kysely', 'sqlalchemy', 'sqlmodel', 'django', 'peewee', 'tortoise-orm', 'gorm.io/gorm', 'diesel', 'sea-orm', 'activerecord', 'rails', 'hibernate-core', 'spring-boot-starter-data-jpa', 'entityframeworkcore', 'microsoft.entityframeworkcore', 'drift', 'floor', 'isar']).map((o) => (o === '@prisma/client' ? 'prisma' : o === 'rails' ? 'activerecord' : o));
  const migrations: ProjectProfile['migrations'] = [];
  const addMig = (tool: string, re: RegExp) => {
    const f = anyFile(ctx, re);
    if (f) migrations.push({ tool, path: f.split('/').slice(0, -1).join('/') });
  };
  addMig('prisma', /(^|\/)prisma\/migrations\//);
  addMig('alembic', /(^|\/)(alembic|migrations)\/versions\//);
  addMig('django', /(^|\/)migrations\/\d{4}_.*\.py$/);
  addMig('rails', /^db\/migrate\//);
  addMig('flyway', /(^|\/)db\/migration\/V\d+/);
  addMig('supabase', /^supabase\/migrations\//);
  addMig('drizzle', /^drizzle\/.*\.sql$/);
  addMig('knex', /(^|\/)migrations\/\d{14}_.*\.(js|ts)$/);
  addMig('golang-migrate', /(^|\/)migrations\/\d+_.*\.(up|down)\.sql$/);
  return { databases: [...databases].sort(), orm: [...new Set(orm)], migrations };
}

const SERVICES: Record<string, string[]> = {
  stripe: ['stripe', '@stripe/stripe-js', 'stripe-python', 'flutter_stripe', '@stripe/react-stripe-js', 'stripe/stripe-php'],
  paypal: ['@paypal/checkout-server-sdk', 'paypalrestsdk', '@paypal/react-paypal-js'],
  aws: ['aws-sdk', '@aws-sdk/client-s3', 'boto3', 'aws-cdk-lib', 'github.com/aws/aws-sdk-go-v2'],
  gcp: ['@google-cloud/storage', 'google-cloud-storage', 'google-cloud-bigquery', 'firebase-admin'],
  azure: ['@azure/storage-blob', 'azure-storage-blob', '@azure/identity'],
  firebase: ['firebase', 'firebase-admin', 'firebase_core', 'firebase_auth', 'cloud_firestore'],
  supabase: ['@supabase/supabase-js', 'supabase', 'supabase_flutter', '@supabase/ssr'],
  auth0: ['@auth0/nextjs-auth0', 'auth0', '@auth0/auth0-react'],
  clerk: ['@clerk/nextjs', '@clerk/clerk-react'],
  'next-auth': ['next-auth', '@auth/core'],
  sentry: ['@sentry/node', '@sentry/nextjs', '@sentry/react', 'sentry-sdk', 'sentry_flutter'],
  openai: ['openai'],
  anthropic: ['@anthropic-ai/sdk', 'anthropic'],
  twilio: ['twilio'],
  sendgrid: ['@sendgrid/mail', 'sendgrid'],
  resend: ['resend'],
  kafka: ['kafkajs', 'confluent-kafka', 'kafka-python', 'github.com/segmentio/kafka-go'],
  rabbitmq: ['amqplib', 'pika'],
  segment: ['analytics-node', '@segment/analytics-next'],
  posthog: ['posthog-js', 'posthog-node', 'posthog'],
  mixpanel: ['mixpanel', 'mixpanel-browser'],
  'google-analytics': ['react-ga4', '@next/third-parties'],
  plaid: ['plaid'],
};

export function detectServices(ctx: ScanContext): string[] {
  return Object.entries(SERVICES).filter(([, deps]) => deps.some((d) => ctx.deps.has(d))).map(([s]) => s);
}

export function detectMcp(ctx: ScanContext): ProjectProfile['mcp'] {
  const file = ['.mcp.json', '.claude/mcp.json'].find((f) => ctx.has(f));
  if (!file) return { servers: [] };
  try {
    const parsed = JSON.parse(ctx.read(file) ?? '{}') as { mcpServers?: Record<string, unknown> };
    return { file, servers: Object.keys(parsed.mcpServers ?? {}) };
  } catch {
    return { file, servers: [] };
  }
}

export function detectInfra(ctx: ScanContext): Pick<ProjectProfile, 'infra' | 'deployment'> {
  const infra: string[] = [];
  const add = (cond: unknown, name: string, list = infra) => cond && !list.includes(name) && list.push(name);
  add(ctx.byName(/^Dockerfile/).length > 0, 'docker');
  add(['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].some((f) => ctx.has(f)), 'docker-compose');
  add(ctx.files.some((f) => f.endsWith('.tf')), 'terraform');
  add(ctx.files.some((f) => /(^|\/)(k8s|kubernetes|manifests)\/.*\.ya?ml$/.test(f)), 'kubernetes');
  add(ctx.byName('Chart.yaml').length > 0, 'helm');
  add(ctx.has('Pulumi.yaml'), 'pulumi');
  add(ctx.has('cdk.json'), 'aws-cdk');
  add(ctx.has('serverless.yml') || ctx.has('serverless.yaml'), 'serverless');
  add(ctx.has('template.yaml') && /AWS::Serverless/.test(ctx.read('template.yaml') ?? ''), 'aws-sam');
  const deployment: string[] = [];
  const dep = (cond: unknown, name: string) => add(cond, name, deployment);
  dep(ctx.has('vercel.json') || ctx.files.some((f) => f.startsWith('.vercel/')), 'vercel');
  dep(ctx.has('netlify.toml'), 'netlify');
  dep(ctx.has('fly.toml'), 'fly.io');
  dep(ctx.has('render.yaml'), 'render');
  dep(ctx.has('railway.json') || ctx.has('railway.toml'), 'railway');
  dep(ctx.has('app.yaml') || ctx.has('app.yml'), 'google-app-engine');
  dep(ctx.has('Procfile'), 'heroku-like');
  dep(ctx.has('firebase.json'), 'firebase-hosting');
  dep(ctx.has('amplify.yml'), 'aws-amplify');
  dep(ctx.has('wrangler.toml') || ctx.has('wrangler.jsonc'), 'cloudflare-workers');
  dep(ctx.has('config/deploy.yml'), 'kamal');
  dep(ctx.has('fastlane/Fastfile') || ctx.has('android/fastlane/Fastfile') || ctx.has('ios/fastlane/Fastfile'), 'app-stores (fastlane)');
  dep(ctx.has('codemagic.yaml'), 'app-stores (codemagic)');
  dep(ctx.has('eas.json'), 'app-stores (expo eas)');
  return { infra, deployment };
}

export function detectDocs(ctx: ScanContext): ProjectProfile['docs'] {
  const docsDir = ['docs', 'doc', 'documentation'].find((d) => ctx.files.some((f) => f.startsWith(`${d}/`)));
  const adrDir = ['docs/adr', 'docs/adrs', 'docs/decisions', 'adr', 'doc/adr', 'docs/architecture/decisions'].find((d) => ctx.files.some((f) => f.startsWith(`${d}/`)));
  return {
    readme: ctx.files.some((f) => /^readme(\.\w+)?$/i.test(f)),
    ...(docsDir ? { docsDir } : {}),
    ...(adrDir ? { adrDir } : {}),
    contributing: ctx.files.some((f) => /^(\.github\/)?contributing(\.\w+)?$/i.test(f)),
    changelog: ctx.files.some((f) => /^changelog(\.\w+)?$/i.test(f)),
  };
}

export function detectSecurity(ctx: ScanContext): ProjectProfile['security'] {
  const envFilesPresent = ctx.files.filter((f) => /(^|\/)\.env(\.[\w-]+)?$/.test(f) && !/\.(example|sample|template|dist)$/.test(f));
  return {
    policy: ctx.files.some((f) => /^(\.github\/)?security(\.\w+)?$/i.test(f)),
    dependabot: ctx.has('.github/dependabot.yml') || ctx.has('.github/dependabot.yaml'),
    renovate: ctx.files.some((f) => /^(\.github\/)?renovate(\.json5?|rc(\.json)?)$|^\.renovaterc/.test(f)),
    codeql: ctx.files.some((f) => /^\.github\/workflows\/.*codeql.*\.ya?ml$/i.test(f)),
    secretScanning: ctx.has('.gitleaks.toml') || ctx.has('.pre-commit-config.yaml') && /gitleaks|detect-secrets|trufflehog/.test(ctx.read('.pre-commit-config.yaml') ?? ''),
    envExample: ctx.files.some((f) => /(^|\/)\.env\.(example|sample|template|dist)$/.test(f)),
    envFilesPresent,
  };
}

const SPDX_HINTS: [RegExp, string][] = [
  [/GNU AFFERO GENERAL PUBLIC LICENSE/i, 'AGPL-3.0'],
  [/GNU LESSER GENERAL PUBLIC LICENSE/i, 'LGPL'],
  [/GNU GENERAL PUBLIC LICENSE/i, 'GPL'],
  [/Mozilla Public License/i, 'MPL-2.0'],
  [/Apache License/i, 'Apache-2.0'],
  [/MIT License|Permission is hereby granted, free of charge/i, 'MIT'],
  [/BSD 3-Clause|Redistribution and use in source and binary forms/i, 'BSD'],
  [/ISC License/i, 'ISC'],
  [/Server Side Public License/i, 'SSPL-1.0'],
  [/Business Source License/i, 'BUSL-1.1'],
  [/unlicense|This is free and unencumbered software/i, 'Unlicense'],
];

export function detectLegal(ctx: ScanContext): ProjectProfile['legal'] {
  const licenseFile = ctx.files.find((f) => /^(licen[cs]e|copying)(\.\w+)?$/i.test(f));
  let license = ctx.packageJson?.license;
  if (!license) license = ctx.read('pyproject.toml')?.match(/^license\s*=\s*(?:"([^"]+)"|\{\s*text\s*=\s*"([^"]+)")/m)?.slice(1).find(Boolean);
  if (!license) license = ctx.read('Cargo.toml')?.match(/^license\s*=\s*"([^"]+)"/m)?.[1];
  if (!license && licenseFile) {
    const text = ctx.read(licenseFile) ?? '';
    license = SPDX_HINTS.find(([re]) => re.test(text))?.[1];
  }
  return {
    ...(license ? { license } : {}),
    ...(licenseFile ? { licenseFile } : {}),
    notice: ctx.files.some((f) => /^(notice|third[-_]party[-_]notices?)(\.\w+)?$/i.test(f)),
    privacyPolicy: ctx.files.some((f) => /privacy[-_]?(policy)?(\.\w+)?$/i.test(f) || /(^|\/)(confidentialite|politique-de-confidentialite)/i.test(f)),
    codeOfConduct: ctx.files.some((f) => /^(\.github\/)?code[-_]of[-_]conduct(\.\w+)?$/i.test(f)),
    codeowners: ctx.has('CODEOWNERS') || ctx.has('.github/CODEOWNERS') || ctx.has('docs/CODEOWNERS'),
    cla: ctx.files.some((f) => /(^|\/)cla(\.\w+)?$/i.test(f)),
  };
}
