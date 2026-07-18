// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

async function parse(source: string) {
  const parser = await import(pathToFileURL(resolve(process.cwd(), 'scripts/parse-supabase-query-json.mjs')).href);
  return parser.parseSupabaseQueryRows(source);
}

describe('Supabase query JSON parser', () => {
  const rows = [{ filename: '060_consent_1_2_cutover.sql' }];

  test.each([
    JSON.stringify(rows),
    JSON.stringify({ rows }),
    JSON.stringify({ result: rows }),
    JSON.stringify({ data: rows }),
    `${JSON.stringify({ level: 'info', msg: 'Connected' })}\n${JSON.stringify({ type: 'row', row: rows[0] })}`
  ])('accepts supported JSON output shapes', async (source) => {
    await expect(parse(source)).resolves.toEqual(rows);
  });

  test.each(['', '{bad json}', JSON.stringify({ level: 'info', msg: 'No result' })])('fails closed for unusable output', async (source) => {
    await expect(async () => {
      const parsed = await parse(source);
      if (!parsed.length) throw new Error('No rows');
    }).rejects.toThrow();
  });
});
