import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/022_session_consents_append_only.sql'),
  'utf8'
);

describe('session consent ledger migration', () => {
  test('contains only consent-ledger hardening in this slice', () => {
    expect(migration).not.toMatch(/insert_reference_link_with_consent|finalize_lead_with_consent|uploaded_files/i);
  });

  test('locks records to the session and resolves equal timestamps by id', () => {
    expect(migration).toMatch(/FROM public\.sessions WHERE id = p_session_id FOR UPDATE/i);
    expect(migration).toMatch(/ORDER BY created_at DESC, id DESC/i);
  });
});
