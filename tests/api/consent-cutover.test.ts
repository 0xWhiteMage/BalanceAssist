// @vitest-environment node
import { describe, expect, test, vi } from 'vitest';
import { isConsent12CutoverActive } from '@/lib/api/consent-cutover';

function client(result: { data: { filename?: string } | null; error: unknown }) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => result) }))
      }))
    }))
  };
}

describe('consent 1.2 cutover readiness', () => {
  test('accepts only the exact recorded cutover migration', async () => {
    await expect(isConsent12CutoverActive(client({ data: { filename: '060_consent_1_2_cutover.sql' }, error: null }))).resolves.toBe(true);
    await expect(isConsent12CutoverActive(client({ data: { filename: '060_renamed.sql' }, error: null }))).resolves.toBe(false);
    await expect(isConsent12CutoverActive(client({ data: null, error: null }))).resolves.toBe(false);
    await expect(isConsent12CutoverActive(client({ data: null, error: { code: 'db_error' } }))).resolves.toBe(false);
  });
});
