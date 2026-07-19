// @vitest-environment node

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  applyProductionIntegrationMigrations,
  integrationMigrationVersions,
  selectIntegrationMigrations,
} from '../../scripts/apply-production-integration-migrations.mjs';

const root = process.cwd();
const execFileAsync = promisify(execFile);
const migrations = [
  ['062', '062_monday_oauth_2_1.sql'],
  ['063', '063_local_media_processing.sql'],
] as const;

describe('production integration migration policy', () => {
  it('hash-verifies exactly migrations 062 and 063 plus their reviewed artifact', async () => {
    expect(integrationMigrationVersions).toEqual(['062', '063']);
    expect(selectIntegrationMigrations(migrations.map(([version, filename]) => ({
      version, filename, path: resolve(root, 'supabase/migrations', filename),
    }))).map(({ version }) => version)).toEqual(['062', '063']);
    await expect(applyProductionIntegrationMigrations({ dryRun: true })).resolves.toEqual({
      planned: migrations.map(([, filename]) => filename),
      schemaVersion: '063',
    });

    const artifact = (await readFile(resolve(root, 'supabase/production-integrations-062-063.sql'), 'utf8')).replace(/\r\n/g, '\n');
    for (const [version, filename] of migrations) {
      const source = (await readFile(resolve(root, 'supabase/migrations', filename), 'utf8')).replace(/\r\n/g, '\n');
      expect(artifact).toContain(`-- BEGIN ${version} ${filename}`);
      expect(artifact).toContain(source);
    }
  });

  it('prints the reviewed plan from the CLI', async () => {
    const { stdout } = await execFileAsync(process.execPath, ['scripts/apply-production-integration-migrations.mjs', '--dry-run'], { cwd: root });
    expect(JSON.parse(stdout)).toEqual({
      planned: migrations.map(([, filename]) => filename),
      schemaVersion: '063',
    });
  });

  it('requires baseline 061, a main-trusted SHA, and the protected environment', async () => {
    const artifact = await readFile(resolve(root, 'supabase/production-integrations-062-063.sql'), 'utf8');
    expect(artifact).toContain("version = '061'");
    expect(artifact).toContain('pg_advisory_xact_lock');

    const source = await readFile(resolve(root, '.github/workflows/production-integration-migrations.yml'), 'utf8');
    const workflow = parse(source) as { jobs?: { migrate?: { environment?: string; steps?: Array<{ run?: string }> } } };
    expect(source).toContain('production-integration-migrations.yml@refs/heads/main');
    expect(workflow.jobs?.migrate?.environment).toBe('production-integration-migrations');
    expect(source).toContain('node scripts/apply-production-integration-migrations.mjs --dry-run');
    expect(source).toContain('supabase db query --linked --file supabase/production-integrations-062-063.sql');
  });
});
