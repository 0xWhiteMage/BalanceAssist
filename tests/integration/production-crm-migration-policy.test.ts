// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import {
  applyProductionCrmMigrations,
  crmMigrationVersions,
  selectCrmMigrations
} from '../../scripts/apply-production-crm-migrations.mjs';

const root = process.cwd();
const execFileAsync = promisify(execFile);
const crmMigrations = [
  ['044', '044_monday_crm_projection_tables.sql'],
  ['047', '047_atomic_crm_approval.sql'],
  ['048', '048_monday_sync_state_machine.sql'],
  ['049', '049_monday_crm_lifecycle.sql'],
  ['052', '052_monday_scheduler_health.sql'],
  ['053', '053_monday_reconciliation.sql']
] as const;

describe('production CRM migration policy', () => {
  it('permits exactly the approved non-contiguous CRM migrations', () => {
    expect(crmMigrationVersions).toEqual(crmMigrations.map(([version]) => version));

    expect(selectCrmMigrations([
      { version: '043', filename: '043_deletion_state_batched_cleanup.sql', path: '/tmp/043' },
      ...crmMigrations.map(([version, filename]) => ({ version, filename, path: `/tmp/${version}` })),
      { version: '045', filename: '045_orphaned_private_attachment_cleanup.sql', path: '/tmp/045' },
      { version: '046', filename: '046_claim_next_handoff_qualification.sql', path: '/tmp/046' },
      { version: '050', filename: '050_legacy_fix.sql', path: '/tmp/050' },
      { version: '051', filename: '051_legacy_fix.sql', path: '/tmp/051' }
    ]).map(({ version }) => version)).toEqual(crmMigrationVersions);
  });

  it('rejects a missing or renamed approved CRM migration', () => {
    expect(() => selectCrmMigrations([])).toThrow('missing reviewed CRM migration 044');
    expect(() => selectCrmMigrations([
      { version: '044', filename: '044_renamed.sql', path: '/tmp/044' },
      ...crmMigrations.slice(1).map(([version, filename]) => ({ version, filename, path: `/tmp/${version}` }))
    ])).toThrow('is not the reviewed file');
  });

  it('hash-verifies LF-normalized source and produces an exact SQL Editor artifact', async () => {
    await expect(applyProductionCrmMigrations({ dryRun: true })).resolves.toEqual({
      planned: crmMigrations.map(([, filename]) => filename),
      schemaVersion: '053'
    });

    const artifact = await readFile(resolve(root, 'supabase/production-monday-crm-044-053.sql'), 'utf8');
    for (const [version, filename] of crmMigrations) {
      const source = await readFile(resolve(root, 'supabase/migrations', filename), 'utf8');
      expect(artifact).toContain(`-- BEGIN ${version} ${filename}`);
      expect(artifact).toContain(source.replace(/\r\n/g, '\n'));
    }
    expect(artifact).not.toContain('045_orphaned_private_attachment_cleanup.sql');
    expect(artifact).not.toContain('046_claim_next_handoff_qualification.sql');
    expect(artifact).not.toContain('050_');
    expect(artifact).not.toContain('051_');
  });

  it('prints the dry-run migration plan when invoked as a CLI', async () => {
    const { stdout } = await execFileAsync(process.execPath, ['scripts/apply-production-crm-migrations.mjs', '--dry-run'], { cwd: root });

    expect(JSON.parse(stdout)).toEqual({
      planned: crmMigrations.map(([, filename]) => filename),
      schemaVersion: '053'
    });
  });

  it('uses a baseline-043 transaction guard and shared advisory lock before applying CRM source', async () => {
    const runner = await readFile(resolve(root, 'scripts/apply-production-crm-migrations.mjs'), 'utf8');
    const artifact = await readFile(resolve(root, 'supabase/production-monday-crm-044-053.sql'), 'utf8');

    for (const source of [runner, artifact]) {
      expect(source).toContain('pg_advisory_xact_lock');
      expect(source).toContain("'043'");
      expect(source).toContain('public.schema_migrations');
      expect(source).toContain('public.sessions');
      expect(source).toContain('INSERT INTO public.schema_migrations');
    }
  });

  it('requires the CRM records before ordinary releases and keeps cleanup restricted to 038-043', async () => {
    const ordinaryRunner = await readFile(resolve(root, 'scripts/apply-production-migrations.mjs'), 'utf8');
    const cleanupRunner = await readFile(resolve(root, 'scripts/apply-production-cleanup-migrations.mjs'), 'utf8');

    expect(ordinaryRunner).toContain('assertReviewedCrmMigrationsRecorded');
    expect(ordinaryRunner).toContain('crmMigrationVersions');
    expect(cleanupRunner).toContain("['043'");
    expect(cleanupRunner).not.toContain("['044'");
  });

  it('protects managed production execution with a main-trusted workflow and approval environment', async () => {
    const workflow = await readFile(resolve(root, '.github/workflows/production-crm-migrations.yml'), 'utf8');

    expect(workflow).toContain('production-crm-migrations.yml@refs/heads/main');
    expect(workflow).toContain('environment: production-crm-migrations');
    expect(workflow).toContain('SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}');
    expect(workflow).toContain('node scripts/apply-production-crm-migrations.mjs --dry-run');
    expect(workflow).toContain("printf '%s\\n' 'vbdqjgwcmckutwehrbvo' > supabase/.temp/project-ref");
    expect(workflow).toContain('npx supabase db query --linked --file supabase/production-monday-crm-044-053.sql');
    expect(workflow).not.toContain('PRODUCTION_DATABASE_URL');
    expect(workflow).not.toMatch(/node scripts\/apply-production-crm-migrations\.mjs(?! --dry-run)/);
  });
});
