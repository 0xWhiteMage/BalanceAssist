// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const migrationPath = resolve(process.cwd(), 'supabase/migrations/057_event_deletion_freeze.sql');

describe('trust feedback deletion freeze migration', () => {
  test('locks the session and rejects event inserts after deletion or expiry', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.guard_event_session_active()');
    expect(sql).toMatch(/deletion_state\s*=\s*'active'/i);
    expect(sql).toMatch(/draft_expires_at\s*>\s*now\(\)/i);
    expect(sql).toContain('FOR SHARE');
    expect(sql).toContain("RAISE EXCEPTION 'session_unavailable'");
    expect(sql).toMatch(/BEFORE INSERT ON public\.events/i);
    expect(sql).toContain('events_require_active_session');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.guard_event_session_active() FROM PUBLIC, anon, authenticated');
  });
});
