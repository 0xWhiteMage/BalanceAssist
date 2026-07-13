// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateIsolatedSupabaseConfig } from '@/lib/testing/supabase-service-role';

const url = process.env.TEST_SUPABASE_URL;
const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.TEST_SUPABASE_ANON_KEY;
const projectRef = process.env.TEST_SUPABASE_PROJECT_REF;
const required = process.env.REQUIRE_TEST_SUPABASE_SERVICE_ROLE === '1';
const error = validateIsolatedSupabaseConfig({
  url,
  serviceRoleKey,
  anonKey,
  projectRef,
  allow: process.env.ALLOW_TEST_SUPABASE_SERVICE_ROLE
});
const serviceRoleTest = error ? (required ? it : it.skip) : it;

function restUrl(table: string, query = '') {
  return new URL(`/rest/v1/${table}${query}`, url!);
}

describe('isolated Supabase service-role access', () => {
  serviceRoleTest(`uses only explicitly enabled test configuration${error ? `: ${error}` : ''}`, async () => {
    if (error) throw new Error(error);

    const sourceUrl = `https://balance-assist-test.invalid/service-role/${randomUUID()}`;
    let serviceInsertSucceeded = false;

    try {
      const inserted = await fetch(restUrl('sessions'), {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey!,
          Authorization: `Bearer ${serviceRoleKey!}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify({ source_url: sourceUrl })
      });
      expect(inserted.status).toBe(201);
      serviceInsertSucceeded = true;

      for (const table of ['sessions', 'leads', 'handoff_outbox']) {
        const anonSelect = await fetch(restUrl(table, '?select=*&limit=1'), {
          headers: { apikey: anonKey!, Authorization: `Bearer ${anonKey!}` }
        });
        expect([401, 403]).toContain(anonSelect.status);
      }
    } finally {
      if (serviceInsertSucceeded) {
        const cleanup = await fetch(
          restUrl('sessions', `?source_url=eq.${encodeURIComponent(sourceUrl)}`),
          {
            method: 'DELETE',
            headers: { apikey: serviceRoleKey!, Authorization: `Bearer ${serviceRoleKey!}` }
          }
        );
        expect(cleanup.status).toBe(204);
      }
    }
  });
});
