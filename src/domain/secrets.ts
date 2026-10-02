/**
 * Détection de secrets à haute précision (peu de faux positifs) et redaction des journaux.
 * Volontairement restreint aux formats reconnaissables : un scanner bruyant serait ignoré.
 */

export interface SecretPattern {
  id: string;
  pattern: RegExp;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  { id: 'aws-access-key', pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'github-token', pattern: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/g },
  { id: 'gitlab-token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'stripe-live-key', pattern: /\b(sk|rk)_live_[A-Za-z0-9]{20,}\b/g },
  { id: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'openai-key', pattern: /\bsk-(proj-)?[A-Za-z0-9_-]{32,}\b/g },
  { id: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'private-key', pattern: /-----BEGIN ([A-Z]+ )?PRIVATE KEY-----/g },
  { id: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { id: 'connection-string-password', pattern: /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqps?):\/\/[^\s:/@]+:[^\s@/]{3,}@/g },
  { id: 'supabase-secret', pattern: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g },
];

export interface SecretFinding {
  id: string;
  line: number;
  preview: string;
}

/** Masque une valeur en gardant 4 caractères de contexte (jamais la valeur entière). */
function mask(value: string): string {
  return `${value.slice(0, 4)}…[REDACTED]`;
}

export function scanText(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const { id, pattern } of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      const m = pattern.exec(line);
      if (m) findings.push({ id, line: i + 1, preview: mask(m[0]) });
    }
  });
  return findings;
}

/** Redaction appliquée à tout ce que le framework journalise. */
export function redact(text: string): string {
  let out = text;
  for (const { pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, (m) => mask(m));
  }
  // Affectations explicites de secrets (KEY=..., "password": "...")
  out = out.replace(/\b([A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*[=:]\s*("?)[^\s"']{6,}\3/gi, '$1=[REDACTED]');
  return out;
}

export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)])) as T;
  }
  return value;
}
