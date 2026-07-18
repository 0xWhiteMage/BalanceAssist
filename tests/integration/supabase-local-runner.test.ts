// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('local Supabase release runner', () => {
  test('skips locally when Docker or the Supabase CLI is unavailable without exposing credentials', async () => {
    const source = await readFile(resolve(process.cwd(), 'scripts/test-supabase.mjs'), 'utf8');

    expect(source).toContain('Skipping local Supabase release journey');
    expect(source).toContain("process.env.CI === 'true'");
    expect(source).toContain("process.env.REQUIRE_SUPABASE_RELEASE_PROOF === '1'");
    expect(source).toContain('Supabase release proof is required but unavailable');
    expect(source).toContain("run('docker', ['info'])");
    expect(source).toContain("['scripts/apply-test-migrations.mjs']");
    expect(source).toContain("['status', '-o', 'env']");
    expect(source).toContain('JSON.parse(value)');
    expect(source).toContain("createBucket(bucket, { public: false })");
    expect(source).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY: environment.ANON_KEY');
    expect(source).not.toContain('console.log(status');
  });

  test('CI installs the CLI, runs the local stack suite, preserves diagnostics, and always stops it', async () => {
    const workflow = await readFile(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

    expect(workflow).toContain('supabase/setup-cli@ab058987d8d6c725971f6cf9d0b5c98467e30bd1');
    expect(workflow).toContain('npm run test:supabase');
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('supabase stop --no-backup');
    expect(workflow).toContain('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
  });

  test('keeps migration tracker hardening safe when Supabase bootstraps before the custom runner', async () => {
    const migration = await readFile(resolve(process.cwd(), 'supabase/migrations/035_schema_migrations_tracker_hardening.sql'), 'utf8');
    const runner = await readFile(resolve(process.cwd(), 'scripts/apply-test-migrations.mjs'), 'utf8');

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.schema_migrations');
    expect(migration).toContain('ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY');
    expect(runner).toContain('supabase_migrations.schema_migrations');
  });

  test('runs the local service-role and anon denial proof with generated credentials', async () => {
    const source = await readFile(resolve(process.cwd(), 'scripts/test-supabase.mjs'), 'utf8');
    const serviceRoleTest = await readFile(resolve(process.cwd(), 'tests/integration/supabase-service-role.test.ts'), 'utf8');

    expect(source).toContain("['run', 'test:supabase:service-role']");
    expect(source).toContain('TEST_SUPABASE_URL: environment.API_URL');
    expect(source).toContain('TEST_SUPABASE_ANON_KEY: environment.ANON_KEY');
    expect(serviceRoleTest).toContain('const trackerSelect');
  });
});
