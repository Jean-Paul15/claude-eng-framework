import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { classifyCommand } from '../src/domain/guardrails.js';

/** Supabase en local (Docker) : la base locale se reconstruit librement ; tout ce qui vise le projet hébergé reste protégé. */
const verdict = (command: string) => classifyCommand(command, { autonomy: 'balanced', protectedBranches: ['main'] });

describe('garde-fous Supabase : local libre, distant protégé', () => {
  it('cycle local sans validation', () => {
    for (const c of ['supabase start', 'supabase db reset', 'supabase db reset --local', 'supabase migration new add_orders', 'supabase db diff -f add_orders', 'supabase db push --local', 'supabase gen types typescript --local', 'supabase functions serve', 'supabase test db', 'supabase db lint']) {
      assert.equal(verdict(c).class, 'autonomous', c);
    }
  });

  it('projet hébergé : validation (ou bypass)', () => {
    for (const c of ['supabase db push', 'supabase db push --remote', 'supabase db reset --linked', 'supabase db reset --db-url postgres://x', 'supabase functions deploy pay', 'supabase config push', 'supabase seed buckets --remote']) {
      assert.equal(verdict(c).class, 'approval', c);
    }
  });
});
