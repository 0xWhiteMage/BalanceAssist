// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '../..');
type Workflow = {
  jobs?: {
    canary?: {
      steps?: Array<{ name?: string; env?: Record<string, string>; run?: string }>;
    };
  };
};

describe('Monday release proof controls', () => {
  test('requires an explicit execution acknowledgement and cleans up a canary through migration 053', async () => {
    const script = await readFile(resolve(root, 'scripts/run-monday-canary.mjs'), 'utf8');

    expect(script).toContain("'--execute'");
    expect(script).toContain('verify-monday-schema.mjs');
    expect(script).toContain('053_monday_reconciliation.sql');
    expect(script).toContain('create_item');
    expect(script).toContain('change_multiple_column_values');
    expect(script).toContain('delete_item');
    expect(script).toContain('finally');
    expect(script).toContain('MONDAY_UPSERT_ENABLED');
    expect(script).toContain('MONDAY_CLEANUP_ENABLED');
    expect(script).toContain("required('MONDAY_CANARY_MIGRATIONS_VERIFIED') !== '1'");
    expect(script).not.toContain("from 'pg'");
    expect(script).not.toContain('PRODUCTION_DATABASE_URL');
  });

  test('keeps the live canary manual, protected, and unable to enable feature lanes', async () => {
    const workflow = await readFile(resolve(root, '.github/workflows/monday-canary.yml'), 'utf8');
    const parsed = parse(workflow) as Workflow;
    const migrationCheck = parsed.jobs?.canary?.steps?.find(({ name }) => name === 'Verify required CRM migrations through the Management API');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('environment: production');
    expect(workflow).toContain('node --env-file');
    expect(workflow).toContain('scripts/run-monday-canary.mjs --execute');
    expect(workflow).not.toMatch(/MONDAY_(?:UPSERT|CLEANUP)_ENABLED\s*[:=]\s*true/);
    expect(workflow).not.toContain('apply-production-crm-migrations');
    expect(workflow).toContain('SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}');
    expect(workflow).toContain('npx --no-install supabase link --project-ref vbdqjgwcmckutwehrbvo --yes');
    expect(workflow).toContain('npx --no-install supabase db query --linked');
    expect(workflow).toContain("MONDAY_CANARY_MIGRATIONS_VERIFIED: '1'");
    expect(workflow).not.toContain('PRODUCTION_DATABASE_URL');
    expect(migrationCheck?.env).toEqual({ SUPABASE_ACCESS_TOKEN: '${{ secrets.SUPABASE_ACCESS_TOKEN }}' });
    expect(migrationCheck?.run).toContain('SELECT 1 / CASE WHEN');
    for (const version of ['044', '047', '048', '049', '052', '053']) {
      expect(workflow).toContain(`'${version}'`);
    }
  });
});
