type IsolatedSupabaseConfig = {
  url?: string;
  serviceRoleKey?: string;
  anonKey?: string;
  projectRef?: string;
  allow?: string;
};

export function validateIsolatedSupabaseConfig(config: IsolatedSupabaseConfig): string | undefined {
  const missing = [
    ['TEST_SUPABASE_URL', config.url],
    ['TEST_SUPABASE_SERVICE_ROLE_KEY', config.serviceRoleKey],
    ['TEST_SUPABASE_ANON_KEY', config.anonKey],
    ['TEST_SUPABASE_PROJECT_REF', config.projectRef]
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) return `Missing ${missing.join(', ')}`;
  if (config.allow !== '1') return 'Set ALLOW_TEST_SUPABASE_SERVICE_ROLE=1 for the dedicated test project';
  if (!/^balance-assist-test-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(config.projectRef!)) {
    return 'TEST_SUPABASE_PROJECT_REF must use the balance-assist-test-* naming policy';
  }

  try {
    const target = new URL(config.url!);
    const expectedHost = `${config.projectRef}.supabase.co`;
    const expectedUrl = `https://${expectedHost}`;
    if (
      (config.url !== expectedUrl && config.url !== `${expectedUrl}/`) ||
      target.protocol !== 'https:' ||
      target.host !== expectedHost ||
      target.pathname !== '/' ||
      target.search ||
      target.hash
    ) {
      return 'TEST_SUPABASE_URL must exactly match the dedicated test-project host';
    }
  } catch {
    return 'TEST_SUPABASE_URL must be a valid URL';
  }

  return undefined;
}
