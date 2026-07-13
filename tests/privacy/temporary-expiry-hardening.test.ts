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

  test('documents that in-flight external transfers cannot be retracted', () => {
    const retention = readFileSync(resolve(process.cwd(), 'docs/temporary-session-retention.md'), 'utf8');
    const readme = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8');
    expect(retention).toMatch(/Once a dispatcher has claimed a handoff.*cannot retract it/i);
    expect(readme).toMatch(/cannot retract an already claimed transfer/i);
  });
});
