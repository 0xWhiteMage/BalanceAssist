// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { validateIsolatedSupabaseConfig } from '@/lib/testing/supabase-service-role';

const validConfig = {
  url: 'https://balance-assist-test-ci.supabase.co',
  serviceRoleKey: 'test-service-role-key',
  anonKey: 'test-anon-key',
  projectRef: 'balance-assist-test-ci',
  allow: '1'
};

describe('isolated Supabase service-role configuration', () => {
  it('accepts only the exact dedicated test-project host', () => {
    expect(validateIsolatedSupabaseConfig(validConfig)).toBeUndefined();
  });

  it.each([
    [{ ...validConfig, projectRef: 'production' }],
    [{ ...validConfig, url: 'https://balance-assist-test-ci.production.supabase.co' }],
    [{ ...validConfig, url: 'https://balance-assist-test-ci.supabase.co.evil.test' }],
    [{ ...validConfig, url: 'https://balance-assist-test-ci.supabase.co:443' }],
    [{ ...validConfig, url: 'https://balance-assist-test-ci.supabase.co:8443' }],
    [{ ...validConfig, allow: '0' }]
  ])('rejects broad markers and production-shaped targets: %o', (config) => {
    expect(validateIsolatedSupabaseConfig(config)).toBeDefined();
  });
});
