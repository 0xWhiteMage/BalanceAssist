import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('durable deletion jobs migration', () => {
  test('defines a PII-free leased job state machine and token-guarded cascade deletion', () => {
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/038_durable_deletion_jobs.sql'), 'utf8');

    expect(migration).toMatch(/CREATE TABLE.*deletion_jobs/is);
    expect(migration).toMatch(/state.*requested.*claimed.*processing.*completed.*failed/is);
    expect(migration).toMatch(/attempts.*lease_token.*lease_expires_at.*requested_at.*completed_at/is);
    expect(migration).toMatch(/UNIQUE INDEX.*deletion_jobs.*session_id/is);
    expect(migration).toMatch(/request_deletion_job.*ON CONFLICT/is);
    expect(migration).toMatch(/claim_deletion_job.*FOR UPDATE SKIP LOCKED/is);
    expect(migration).toMatch(/complete_deletion_job.*p_lease_token/is);
    expect(migration).toMatch(/fail_deletion_job.*p_lease_token/is);
    expect(migration).toMatch(/delete_session_for_deletion_job.*DELETE FROM public.sessions/is);
    expect(migration).not.toMatch(/draft|contact|payload|object_key|error_message/i);
  });
});
