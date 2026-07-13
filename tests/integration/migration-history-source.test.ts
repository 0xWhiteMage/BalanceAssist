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
    await expect(readFile(resolve(process.cwd(), 'README.md'), 'utf8')).resolves.toContain('032_legacy_cleanup_record_remediation.sql');
  });
});
