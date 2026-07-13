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
  });
});
