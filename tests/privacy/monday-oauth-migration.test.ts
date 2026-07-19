import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/062_monday_oauth_2_1.sql'), 'utf8');

describe('Monday OAuth migration 062', () => {
  test('stores one-use attempts and one encrypted connection without plaintext token columns', () => {
    expect(migration).toMatch(/CREATE TABLE public\.monday_oauth_attempts/i);
    expect(migration).toMatch(/state_hash text PRIMARY KEY.*\{64\}/is);
    expect(migration).toMatch(/CREATE TABLE public\.monday_oauth_connection/i);
    expect(migration).toMatch(/singleton boolean PRIMARY KEY.*CHECK \(singleton\)/is);
    expect(migration).toMatch(/encrypted_access_token text NOT NULL/i);
    expect(migration).toMatch(/encrypted_refresh_token text NOT NULL/i);
    expect(migration).not.toMatch(/\n\s+access_token text/i);
    expect(migration).not.toMatch(/\n\s+refresh_token text/i);
  });

  test('uses one-use consume and leased compare-and-swap rotation operations', () => {
    expect(migration).toMatch(/FUNCTION public\.consume_monday_oauth_attempt.*DELETE FROM public\.monday_oauth_attempts/is);
    expect(migration).toMatch(/FUNCTION public\.install_monday_oauth_connection/is);
    expect(migration).toMatch(/FUNCTION public\.acquire_monday_oauth_refresh_lease/is);
    expect(migration).toMatch(/FUNCTION public\.rotate_monday_oauth_tokens/is);
    expect(migration).toMatch(/FUNCTION public\.disconnect_monday_oauth_connection[\s\S]*DELETE FROM public\.monday_oauth_connection/is);
    expect(migration).toMatch(/token_version = p_expected_version/is);
    expect(migration).toMatch(/refresh_lease_owner = p_owner/is);
  });

  test('enables RLS and grants only the service role', () => {
    expect(migration).toMatch(/ALTER TABLE public\.monday_oauth_attempts ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/ALTER TABLE public\.monday_oauth_connection ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/REVOKE ALL PRIVILEGES ON TABLE public\.monday_oauth_attempts, public\.monday_oauth_connection FROM PUBLIC/i);
    expect(migration).toMatch(/REVOKE ALL PRIVILEGES.*FROM anon/is);
    expect(migration).toMatch(/REVOKE ALL PRIVILEGES.*FROM authenticated/is);
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE.*TO service_role/is);
    expect(migration).toMatch(/SECURITY DEFINER SET search_path = public, pg_temp/is);
  });
});
