// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

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
  });

  test('keeps the live canary manual, protected, and unable to enable feature lanes', async () => {
    const workflow = await readFile(resolve(root, '.github/workflows/monday-canary.yml'), 'utf8');

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('environment: production');
    expect(workflow).toContain('node --env-file');
    expect(workflow).toContain('scripts/run-monday-canary.mjs --execute');
    expect(workflow).not.toMatch(/MONDAY_(?:UPSERT|CLEANUP)_ENABLED\s*[:=]\s*true/);
    expect(workflow).not.toContain('apply-production-crm-migrations');
  });
});
