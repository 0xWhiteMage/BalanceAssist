import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const sql = readFileSync('supabase/migrations/061_api_security_retention_and_upload_quota.sql', 'utf8');

describe('API security migration', () => {
  test('serializes cumulative upload quota reservations per session', () => {
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtextextended\(p_session_id::text, 0\)\)/i);
    expect(sql).toMatch(/sum\(size_bytes\)[\s\S]+uploaded_files[\s\S]+sum\(size_bytes\)[\s\S]+session_upload_reservations/i);
    expect(sql).toMatch(/expires_at <= now\(\)/i);
  });

  test('provides bounded Telegram replay retention', () => {
    expect(sql).toMatch(/prune_processed_telegram_updates/i);
    expect(sql).toMatch(/received_at < now\(\) - p_retention/i);
    expect(sql).toMatch(/LIMIT p_batch_size/i);
  });

  test('denies quota and replay RPC access to public API roles', () => {
    expect(sql).toMatch(/REVOKE ALL PRIVILEGES ON TABLE public\.session_upload_reservations FROM anon/i);
    expect(sql).toMatch(/REVOKE ALL PRIVILEGES ON TABLE public\.session_upload_reservations FROM authenticated/i);
    expect(sql).toMatch(/release_session_upload_quota\(uuid\) FROM anon/i);
    expect(sql).toMatch(/release_session_upload_quota\(uuid\) FROM authenticated/i);
  });
});
