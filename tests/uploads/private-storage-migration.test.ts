// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('private attachment storage migration', () => {
  test('adds private lifecycle fields, constraints, RLS, and guarded bucket provisioning', () => {
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/029_private_attachment_storage.sql'), 'utf8');

    expect(migration).toMatch(/object_key text/i);
    expect(migration).toMatch(/checksum_sha256 text/i);
    expect(migration).toMatch(/retention_expires_at timestamptz/i);
    expect(migration).toMatch(/status.*stored.*pending_delivery.*sent.*suppressed.*failed.*expired/is);
    expect(migration).toMatch(/idempotency_key uuid/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/storage\.buckets/i);
    expect(migration).toMatch(/storage\.objects.*ENABLE ROW LEVEL SECURITY/is);
    expect(migration).toMatch(/public = false/i);
    expect(migration).toMatch(/to_regclass\('storage\.buckets'\)/i);
  });

  test('creates opaque orphan cleanup storage and fails closed when Storage policy management is unavailable', () => {
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/030_private_attachment_retention.sql'), 'utf8');

    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.private_attachment_cleanup/i);
    expect(migration).toMatch(/object_key text PRIMARY KEY/i);
    expect(migration).toMatch(/bucket text NOT NULL/i);
    expect(migration).toMatch(/checksum_sha256 text NOT NULL/i);
    expect(migration).toMatch(/retention_expires_at timestamptz NOT NULL/i);
    expect(migration).toMatch(/status text NOT NULL/i);
    const cleanupTable = migration.match(/CREATE TABLE IF NOT EXISTS public\.private_attachment_cleanup \([\s\S]*?\n\);/i)?.[0] ?? '';
    expect(cleanupTable).not.toMatch(/filename|session_id/i);
    expect(migration).toMatch(/private_attachment_storage_readiness/i);
    expect(migration).toMatch(/storage schema is unavailable/i);
    expect(migration).toMatch(/DROP POLICY IF EXISTS/i);
    expect(migration).toMatch(/anon|authenticated/i);
    expect(migration).toMatch(/REVOKE ALL PRIVILEGES ON TABLE storage\.objects FROM anon, authenticated/i);
  });
});
