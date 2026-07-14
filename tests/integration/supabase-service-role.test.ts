// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const url = process.env.TEST_SUPABASE_URL;
const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.TEST_SUPABASE_ANON_KEY;
const localStack = process.env.TEST_SUPABASE_LOCAL === '1';
const error = !localStack || !url || !serviceRoleKey || !anonKey
  ? 'Local Supabase test configuration is unavailable'
  : !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)
    ? 'TEST_SUPABASE_URL must be a local Supabase endpoint'
    : undefined;
const serviceRoleTest = error ? it.skip : it;

function restUrl(table: string, query = '') {
  return new URL(`/rest/v1/${table}${query}`, url!);
}

describe('local Supabase service-role access', () => {
  serviceRoleTest(`allows service role and denies anon access${error ? `: ${error}` : ''}`, async () => {
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

      const trackerSelect = await fetch(restUrl('schema_migrations', '?select=*&limit=1'), {
        headers: { apikey: serviceRoleKey!, Authorization: `Bearer ${serviceRoleKey!}` }
      });
      expect(trackerSelect.status).toBe(200);

      for (const table of ['sessions', 'leads', 'handoff_outbox', 'schema_migrations']) {
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
