// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

type Migration = {
  version: string;
  filename: string;
  path: string;
};

type MigrationRunner = {
  getIncrementalMigrations(migrationsDir: string): Migration[];
};

const temporaryDirectories: string[] = [];

async function loadRunner(): Promise<MigrationRunner> {
  return import(
    pathToFileURL(resolve(process.cwd(), 'scripts/apply-test-migrations.mjs')).href
  ) as Promise<MigrationRunner>;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('test migration runner', () => {
  it('orders migrations by numeric version', async () => {
    const migrationsDir = await mkdtemp(resolve(tmpdir(), 'balance-assist-migrations-'));
    temporaryDirectories.push(migrationsDir);
    await writeFile(resolve(migrationsDir, '1000_after.sql'), 'select 1;');
    await writeFile(resolve(migrationsDir, '2_second.sql'), 'select 2;');
    await writeFile(resolve(migrationsDir, '999_before.sql'), 'select 3;');
    await writeFile(resolve(migrationsDir, '10_tenth.sql'), 'select 4;');

    const runner = await loadRunner();

    expect(runner.getIncrementalMigrations(migrationsDir).map((migration) => migration.filename)).toEqual([
      '2_second.sql',
      '10_tenth.sql',
      '999_before.sql',
      '1000_after.sql'
    ]);
  });

  it('rejects differently padded duplicate numeric migration versions', async () => {
    const migrationsDir = await mkdtemp(resolve(tmpdir(), 'balance-assist-migrations-'));
    temporaryDirectories.push(migrationsDir);
    await writeFile(resolve(migrationsDir, '002_first.sql'), 'select 1;');
    await writeFile(resolve(migrationsDir, '2_second.sql'), 'select 2;');

    const runner = await loadRunner();

    expect(() => runner.getIncrementalMigrations(migrationsDir)).toThrow(/Duplicate migration version 2/);
  });

  it('rejects duplicate migration version numbers', async () => {
    const migrationsDir = await mkdtemp(resolve(tmpdir(), 'balance-assist-migrations-'));
    temporaryDirectories.push(migrationsDir);
    await writeFile(resolve(migrationsDir, '001_first.sql'), 'select 1;');
    await writeFile(resolve(migrationsDir, '001_second.sql'), 'select 2;');

    const runner = await loadRunner();

    expect(() => runner.getIncrementalMigrations(migrationsDir)).toThrow(/Duplicate migration version 001/);
  });

  it('preserves the root test database migration identities through final review approval', async () => {
    const runner = await loadRunner();

    expect(runner.getIncrementalMigrations(resolve(process.cwd(), 'supabase/migrations'))
      .filter((migration) => Number(migration.version) >= 44)
      .map((migration) => migration.filename)).toEqual([
      '044_monday_crm_projection_tables.sql',
      '045_orphaned_private_attachment_cleanup.sql',
      '046_claim_next_handoff_qualification.sql',
      '047_atomic_crm_approval.sql',
      '048_monday_sync_state_machine.sql',
      '049_monday_crm_lifecycle.sql',
      '052_monday_scheduler_health.sql',
      '053_monday_reconciliation.sql',
      '054_human_contact_consent.sql',
      '055_final_review_approval.sql'
    ]);
  });

  it('prepares the local Supabase database before the HTTP release journey runs', async () => {
    const packageJson = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8'));
    const workflow = await readFile(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

    expect(packageJson.scripts['test:db:prepare']).toBe('node scripts/apply-test-migrations.mjs');
    expect(packageJson.scripts['test:supabase']).toBe('node scripts/test-supabase.mjs');
    expect(packageJson.scripts['test:release-proof:http']).toBe(
      'vitest run --no-file-parallelism tests/integration/release-proof-http.test.ts'
    );
    expect(workflow).toContain('supabase/setup-cli@ab058987d8d6c725971f6cf9d0b5c98467e30bd1');
    expect(workflow).toContain('- run: npm run test:supabase');
  });

  it('runs the release-proof journey after local stack setup and publishes failure evidence', async () => {
    const workflow = await readFile(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
    const playwright = await readFile(resolve(process.cwd(), 'playwright.config.ts'), 'utf8');

    expect(workflow).toContain('- run: npm run test:supabase');
    expect(workflow).toContain('supabase stop --no-backup');
    expect(workflow).toContain('supabase-release-proof-diagnostics');
    expect(workflow).toContain('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
    expect(workflow).toContain('playwright-report');
    expect(playwright).toContain('retries: process.env.CI ? 2 : 0');
    expect(playwright).toContain("trace: 'retain-on-failure'");
    expect(playwright).toContain("screenshot: 'only-on-failure'");
  });

  it('does not require external Supabase service-role secrets in CI', async () => {
    const packageJson = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8'));
    const workflow = await readFile(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

    expect(packageJson.scripts['test:supabase:service-role']).toBe(
      'vitest run tests/integration/supabase-service-role.test.ts'
    );
    expect(workflow).not.toContain('supabase-service-role:');
    for (const secret of [
      'TEST_SUPABASE_URL',
      'TEST_SUPABASE_SERVICE_ROLE_KEY',
      'TEST_SUPABASE_ANON_KEY',
      'TEST_SUPABASE_PROJECT_REF'
    ]) {
      expect(workflow).not.toContain(`secrets.${secret}`);
    }
    expect(workflow).toContain('supabase/setup-cli@ab058987d8d6c725971f6cf9d0b5c98467e30bd1');
  });
});
