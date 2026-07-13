// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

const url = process.env.TEST_SUPABASE_URL;
const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.TEST_SUPABASE_ANON_KEY;
const projectMarker = process.env.TEST_SUPABASE_PROJECT_MARKER;
const required = process.env.REQUIRE_TEST_SUPABASE_SERVICE_ROLE === '1';

function configurationError() {
  const missing = [
    ['TEST_SUPABASE_URL', url],
    ['TEST_SUPABASE_SERVICE_ROLE_KEY', serviceRoleKey],
    ['TEST_SUPABASE_ANON_KEY', anonKey],
    ['TEST_SUPABASE_PROJECT_MARKER', projectMarker]
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) return `Missing ${missing.join(', ')}`;
  if (process.env.ALLOW_TEST_SUPABASE_SERVICE_ROLE !== '1') {
    return 'Set ALLOW_TEST_SUPABASE_SERVICE_ROLE=1 for an isolated test project';
  }

  try {
    if (!new URL(url!).hostname.includes(projectMarker!)) {
      return 'TEST_SUPABASE_URL must contain TEST_SUPABASE_PROJECT_MARKER in its host';
    }
  } catch {
    return 'TEST_SUPABASE_URL must be a valid URL';
  }

  return undefined;
}

const error = configurationError();
const serviceRoleTest = error ? (required ? it : it.skip) : it;

describe('isolated Supabase service-role access', () => {
  serviceRoleTest(`uses only explicitly enabled test configuration${error ? `: ${error}` : ''}`, async () => {
    if (error) throw new Error(error);

    const service = createClient(url!, serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const anon = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const sourceUrl = `https://service-role-test.invalid/${randomUUID()}`;
    let sessionId: string | undefined;

    try {
      const inserted = await service.from('sessions').insert({ source_url: sourceUrl }).select('id').single();
      expect(inserted.error).toBeNull();
      sessionId = inserted.data?.id;
      expect(sessionId).toEqual(expect.any(String));

      const anonSelect = await anon.from('sessions').select('id').limit(1);
      expect(anonSelect.error).not.toBeNull();

      const anonInsert = await anon.from('sessions').insert({ source_url: sourceUrl });
      expect(anonInsert.error).not.toBeNull();
    } finally {
      if (sessionId) {
        const deleted = await service.from('sessions').delete().eq('id', sessionId);
        expect(deleted.error).toBeNull();
      }
    }
  });
});
