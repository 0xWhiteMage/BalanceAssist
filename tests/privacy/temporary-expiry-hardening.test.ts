import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('temporary expiry hardening migration', () => {
  test('adds defaults and a purge-only consent-ledger delete context', () => {
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/024_temporary_expiry_hardening.sql'), 'utf8');
    expect(migration).toMatch(/draft_expires_at SET DEFAULT/i);
    expect(migration).toMatch(/last_activity_at SET DEFAULT/i);
    expect(migration).toMatch(/set_config\('app\.session_purge', 'on'/i);
    expect(migration).toMatch(/current_setting\('app\.session_purge', true\) = 'on'/i);
    expect(migration).toMatch(/FUNCTION public\.authorize_handoff_send/i);
    expect(migration).toMatch(/handoff\.session_id = session_row\.id/i);
    expect(migration).toMatch(/session_row\.draft_expires_at > now\(\)/i);
  });

  test('supersedes pre-send authorization with claim-time eligibility and active-lease purge deferral', () => {
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/025_in_flight_handoff_retention.sql'), 'utf8');
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS claimed_at timestamptz/i);
    expect(migration).toMatch(/FUNCTION public\.claim_next_handoff\(\)/i);
    expect(migration).toMatch(/draft_expires_at <= now_at/i);
    expect(migration).toMatch(/scope = 'producer_transfer'/i);
    expect(migration).toMatch(/o\.state = 'claiming'\s+AND o\.claim_expires_at > now\(\)/i);
    expect(migration).toMatch(/DELETE FROM public\.sessions/i);
    expect(migration).toMatch(/DROP FUNCTION IF EXISTS public\.authorize_handoff_send\(uuid\)/i);
  });

  test('drops the integer purge function before replacing it with the jsonb result and restores service-only access', () => {
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/025_in_flight_handoff_retention.sql'), 'utf8');
    expect(migration).toMatch(/DROP FUNCTION IF EXISTS public\.purge_expired_temporary_sessions\(\)/i);
    expect(migration.indexOf('DROP FUNCTION IF EXISTS public.purge_expired_temporary_sessions()'))
      .toBeLessThan(migration.indexOf('CREATE OR REPLACE FUNCTION public.purge_expired_temporary_sessions()'));
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.purge_expired_temporary_sessions\(\) FROM PUBLIC/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.purge_expired_temporary_sessions\(\) TO service_role/i);
  });

  test('adds ownership tokens and bounded send semantics in a forward migration', () => {
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/026_handoff_claim_ownership.sql'), 'utf8');
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS claim_token uuid/i);
    expect(migration).toMatch(/claim_token = gen_random_uuid\(\)/i);
    expect(migration).toMatch(/FUNCTION public\.renew_handoff_claim/i);
    expect(migration).toMatch(/claim_expires_at = now_at \+ interval '2 minutes'/i);
  });

  test('documents bounded send reservations and the remaining at-least-once ambiguity', () => {
    const retention = readFileSync(resolve(process.cwd(), 'docs/temporary-session-retention.md'), 'utf8');
    const readme = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8');
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/027_handoff_send_reservations.sql'), 'utf8');
    expect(retention).toMatch(/reserves it for 90 seconds/i);
    expect(retention).toMatch(/at-least-once and can duplicate/i);
    expect(readme).toMatch(/027_handoff_send_reservations\.sql/i);
    expect(migration).toMatch(/state = 'pending'.*claim_token = NULL/is);
    expect(migration).toMatch(/CREATE FUNCTION public\.reserve_handoff_send/i);
    expect(migration).toMatch(/interval '90 seconds'/i);
  });
});
