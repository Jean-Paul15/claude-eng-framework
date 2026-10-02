import type { RiskLevel } from '../domain/types.js';
import type { ScanContext } from './context.js';
import type { Evidence, ProjectProfile } from './profile.js';

/**
 * Signaux de domaine → niveau de risque. La découverte ne fait qu'émettre des indices ;
 * l'orchestrateur les confirme ou les infirme au bootstrap (et peut corriger la config).
 */
interface DomainRule {
  domain: string;
  deps?: string[];
  services?: string[];
  path?: RegExp;
}

const RULES: DomainRule[] = [
  { domain: 'payments', services: ['stripe', 'paypal', 'plaid'], deps: ['braintree', '@adyen/api-library', 'mollie-api-node', 'square', 'razorpay', 'lemonsqueezy.js'], path: /(^|\/)(payments?|billing|checkout|invoices?|subscriptions?)(\/|\.)/i },
  { domain: 'finance', deps: ['decimal.js', 'big.js', 'dinero.js', 'currency.js', 'quantlib', 'ccxt'], path: /(^|\/)(ledger|accounting|trading|wallet|banking)(\/|\.)/i },
  { domain: 'health', deps: ['fhir', 'fhirclient', 'hl7', 'fhir.resources'], path: /(^|\/)(patients?|medical|clinical|ehr|fhir)(\/|\.)/i },
  { domain: 'auth', services: ['auth0', 'clerk', 'next-auth', 'firebase', 'supabase'], deps: ['passport', 'jsonwebtoken', 'jose', 'bcrypt', 'bcryptjs', 'argon2', 'pyjwt', 'python-jose', 'authlib', 'devise', 'django-allauth', 'firebase_auth', 'lucia', 'better-auth', 'spring-boot-starter-security', 'golang.org/x/oauth2'], path: /(^|\/)(auth|login|sessions?|oauth|sso)(\/|\.)/i },
  { domain: 'pii', path: /(^|\/)(users?|profiles?|customers?|accounts?|gdpr|consent|personal[-_]?data)(\/|\.|_)/i },
  { domain: 'multi-tenant', path: /(^|\/)(tenants?|organizations?|workspaces?)(\/|\.)/i },
  { domain: 'upload', deps: ['multer', 'formidable', 'busboy', '@uploadthing/react', 'python-multipart', 'file_picker', 'image_picker'], path: /(^|\/)uploads?(\/|\.)/i },
  { domain: 'webhooks', path: /(^|\/)webhooks?(\/|\.)/i },
  { domain: 'ai-llm', services: ['openai', 'anthropic'], deps: ['langchain', '@langchain/core', 'llamaindex', 'ai', '@ai-sdk/openai', 'litellm'] },
  { domain: 'analytics', services: ['segment', 'posthog', 'mixpanel', 'google-analytics'] },
  { domain: 'infra', path: /\.tf$|(^|\/)(k8s|kubernetes|helm)\//i },
  { domain: 'command-execution', deps: ['execa', 'shelljs', 'node-pty'] },
  { domain: 'crypto', deps: ['ethers', 'web3', 'viem', '@solana/web3.js', 'bitcoinjs-lib'] },
  { domain: 'database-migration', path: /(^|\/)(migrations?|migrate)\//i },
  { domain: 'realtime', deps: ['socket.io', 'ws', 'pusher', 'ably', '@supabase/realtime-js', 'channels'] },
];

export function detectDomains(ctx: ScanContext, services: readonly string[]): Evidence[] {
  const out: Evidence[] = [];
  for (const rule of RULES) {
    const svc = rule.services?.find((s) => services.includes(s));
    if (svc) {
      out.push({ name: rule.domain, evidence: `service ${svc}` });
      continue;
    }
    const dep = rule.deps?.find((d) => ctx.deps.has(d));
    if (dep) {
      out.push({ name: rule.domain, evidence: `dépendance ${dep}` });
      continue;
    }
    const file = rule.path ? ctx.files.find((f) => rule.path!.test(f) && !/(^|\/)(test|tests|__tests__|fixtures?|mocks?)\//.test(f)) : undefined;
    if (file) out.push({ name: rule.domain, evidence: `fichier ${file}` });
  }
  return out;
}

export function inferRisk(profile: Pick<ProjectProfile, 'domains' | 'projectTypes' | 'deployment'>): RiskLevel {
  const d = new Set(profile.domains.map((x) => x.name));
  if (d.has('payments') || d.has('finance') || d.has('health') || d.has('crypto')) return 'critical';
  if (d.has('auth') || d.has('pii') || d.has('multi-tenant') || d.has('infra') || d.has('ai-llm')) return 'high';
  if (profile.projectTypes.every((t) => t === 'library' || t === 'cli' || t === 'unknown') && profile.deployment.length === 0) return 'low';
  return 'medium';
}
