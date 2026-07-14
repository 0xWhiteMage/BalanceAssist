// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('local Supabase release runner', () => {
  test('skips locally when Docker or the Supabase CLI is unavailable without exposing credentials', async () => {
    const source = await readFile(resolve(process.cwd(), 'scripts/test-supabase.mjs'), 'utf8');

    expect(source).toContain('Skipping local Supabase release journey');
    expect(source).toContain("run('docker', ['info'])");
    expect(source).toContain("['scripts/apply-test-migrations.mjs']");
    expect(source).toContain("['status', '-o', 'env']");
    expect(source).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY: environment.ANON_KEY');
    expect(source).not.toContain('console.log(status');
  });

  test('CI installs the CLI, runs the local stack suite, preserves diagnostics, and always stops it', async () => {
    const workflow = await readFile(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

    expect(workflow).toContain('supabase/setup-cli@v1');
    expect(workflow).toContain('npm run test:supabase');
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('supabase stop --no-backup');
    expect(workflow).toContain('actions/upload-artifact@v4');
  });
});
