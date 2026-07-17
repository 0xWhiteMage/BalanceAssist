// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

import { PUBLIC_REFERENCE_RESERVED_IP_RANGES } from '@/lib/uploads/url-detect';

test('keeps the TypeScript reserved IP policy synchronized with migration 047 SQL', async () => {
  const sql = await readFile(resolve(process.cwd(), 'supabase/migrations/047_atomic_crm_approval.sql'), 'utf8');
  const functionSource = sql.match(/CREATE FUNCTION public\.normalize_public_reference_url[\s\S]+?\$\$;/)?.[0];
  expect(functionSource).toBeDefined();

  const sqlRanges = [...functionSource!.matchAll(/inet '([^']+\/\d+)'/g)].map((match) => match[1]);
  expect(PUBLIC_REFERENCE_RESERVED_IP_RANGES).toEqual(sqlRanges);
});
