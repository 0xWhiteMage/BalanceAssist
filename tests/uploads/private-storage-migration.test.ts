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
});
