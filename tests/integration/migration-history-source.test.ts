// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('database migration history expectation', () => {
  it('includes the temporary-session migrations when no test database is configured', async () => {
    const source = await readFile(resolve(process.cwd(), 'tests/integration/database-schema.test.ts'), 'utf8');

    expect(source).toContain("'023:023_temporary_session_retention.sql'");
    expect(source).toContain("'024:024_temporary_expiry_hardening.sql'");
    expect(source).toContain("'028:028_handoff_reservation_consent_recheck.sql'");
    expect(source).toContain("'029:029_private_attachment_storage.sql'");
    expect(source).toContain("'030:030_private_attachment_retention.sql'");
    expect(source).toContain("'031:031_private_attachment_cleanup_hardening.sql'");
    expect(source).toContain("'032:032_legacy_cleanup_record_remediation.sql'");
    expect(source).toContain("'033:033_private_attachment_live_attestation.sql'");
    expect(source).toContain("'034:034_private_attachment_effective_attestation.sql'");
    expect(source).toContain("'035:035_schema_migrations_tracker_hardening.sql'");
    await expect(readFile(resolve(process.cwd(), 'README.md'), 'utf8')).resolves.toContain('035_schema_migrations_tracker_hardening.sql');
  });

  it('keeps tracker hardening in a forward migration rather than changing recorded 018', async () => {
    const migration = await readFile(
      resolve(process.cwd(), 'supabase/migrations/035_schema_migrations_tracker_hardening.sql'),
      'utf8'
    );

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.schema_migrations');
    expect(migration).toContain('ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations FROM PUBLIC');
    expect(migration).toContain('FROM anon');
    expect(migration).toContain('FROM authenticated');
  });
});
