// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/063_local_media_processing.sql'), 'utf8');

describe('local media processing migration 063', () => {
  test('defines bounded service-role-only tables and payloads', () => {
    expect(migration).toMatch(/CREATE TABLE public\.media_processing_jobs/i);
    expect(migration).toMatch(/CREATE TABLE public\.media_derivatives/i);
    expect(migration).toMatch(/operation IN \('ocr', 'image_visual', 'video_visual'\)/i);
    expect(migration).toMatch(/attempts BETWEEN 0 AND 3/i);
    expect(migration).toMatch(/pg_column_size\(result\) <= 262144/i);
    expect(migration).toMatch(/size_bytes <= 256000.*width IS NOT NULL.*height IS NOT NULL/is);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/gi);
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.media_processing_jobs, public\.media_derivatives TO service_role/i);
    expect(migration).toMatch(/REVOKE ALL PRIVILEGES ON TABLE public\.media_processing_jobs, public\.media_derivatives FROM authenticated/i);
    expect(migration).toMatch(/private_media_storage_is_ready[\s\S]*pg_policies/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.reserve_session_upload_quota[\s\S]*media_processing_jobs/i);
    expect(migration).toMatch(/v_used_bytes \+ p_declared_size_bytes > 104857600/i);
    expect(migration).not.toMatch(/quota_reservation_id/i);
    expect(migration).toMatch(/assert_session_processing_allowed\(p_session_id\)/i);
  });

  test('owns lease-guarded job transitions and cleanup links', () => {
    expect(migration).toMatch(/claim_media_processing_job[\s\S]*FOR UPDATE SKIP LOCKED/i);
    expect(migration).toMatch(/state = 'claimed'.*attempts = attempts \+ 1/is);
    expect(migration).toMatch(/start_media_processing_job[\s\S]*lease_token = p_lease_token[\s\S]*lease_expires_at > now\(\)/i);
    expect(migration).toMatch(/complete_media_processing_job[\s\S]*state = 'succeeded'/i);
    expect(migration).toMatch(/fail_media_processing_job[\s\S]*v_attempts < 3[\s\S]*'queued'.*'failed'/is);
    expect(migration).toMatch(/sessions_cancel_media_jobs/i);
    expect(migration).toMatch(/session_consents_cancel_media_jobs/i);
    expect(migration).toMatch(/claim_media_cleanup/i);
    expect(migration).toMatch(/upload_expires_at <= now\(\)[\s\S]*cleanup_state = 'pending'/i);
    expect(migration).toMatch(/attempts >= 3 AND lease_expires_at <= now\(\)/i);
  });

  test('keeps media processing local and never mutates Storage relations', () => {
    expect(migration).not.toMatch(/ALTER TABLE storage\.|INSERT INTO storage\.|UPDATE storage\.|DELETE FROM storage\./i);
    expect(migration).not.toMatch(/openai|google|aws|azure|replicate|visual provider/i);
  });
});
