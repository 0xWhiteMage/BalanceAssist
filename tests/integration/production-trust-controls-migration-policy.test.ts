// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import {
  applyProductionTrustControlsMigrations,
  selectTrustControlsMigration,
  trustControlsMigrationVersion
} from '../../scripts/apply-production-trust-controls-migrations.mjs';

const root = process.cwd();
type Workflow = {
  jobs?: Record<string, {
    environment?: string;
    env?: Record<string, string>;
    steps?: Array<{ env?: Record<string, string>; run?: string }>;
  }>;
};

describe('production trust controls migration policy', () => {
  it('permits only the reviewed human contact consent migration', () => {
    expect(trustControlsMigrationVersion).toBe('054');
    expect(selectTrustControlsMigration([
      { version: '053', filename: '053_monday_reconciliation.sql', path: '/tmp/053' },
      { version: '054', filename: '054_human_contact_consent.sql', path: '/tmp/054' },
      { version: '055', filename: '055_additive.sql', path: '/tmp/055' }
    ]).version).toBe('054');
    expect(() => selectTrustControlsMigration([])).toThrow('missing reviewed trust controls migration 054');
    expect(() => selectTrustControlsMigration([{ version: '054', filename: '054_renamed.sql', path: '/tmp/054' }])).toThrow('is not the reviewed file');
  });

  it('hash-verifies the reviewed source and transactional SQL Editor artifact', async () => {
    await expect(applyProductionTrustControlsMigrations({ dryRun: true })).resolves.toEqual({
      planned: ['054_human_contact_consent.sql'],
      schemaVersion: '054'
    });

    const source = (await readFile(resolve(root, 'supabase/migrations/054_human_contact_consent.sql'), 'utf8')).replace(/\r\n/g, '\n');
    const artifact = (await readFile(resolve(root, 'supabase/production-trust-controls-054.sql'), 'utf8')).replace(/\r\n/g, '\n');

    expect(artifact).toContain('-- BEGIN 054 054_human_contact_consent.sql');
    expect(artifact).toContain(source);
    expect(artifact).toContain('BEGIN;');
    expect(artifact).toContain('SELECT pg_advisory_xact_lock(90442054);');
    expect(artifact).toContain("version = '053' AND filename = '053_monday_reconciliation.sql'");
    expect(artifact).toContain("version = '054'");
    expect(artifact).toContain('INSERT INTO public.schema_migrations');
    expect(artifact).toContain("RAISE EXCEPTION 'trust controls migration verification failed'");
    expect(artifact.trimEnd()).toMatch(/COMMIT;$/);
  });

  it('rejects an artifact with appended SQL during dry-run verification', async () => {
    const artifact = await readFile(resolve(root, 'supabase/production-trust-controls-054.sql'), 'utf8');
    const artifactDir = await mkdtemp(resolve(tmpdir(), 'balance-assist-trust-controls-artifact-'));
    const artifactPath = resolve(artifactDir, 'production-trust-controls-054.sql');

    try {
      await writeFile(artifactPath, `${artifact}\nSELECT 'unreviewed artifact SQL';\n`);
      await expect(applyProductionTrustControlsMigrations({ dryRun: true, artifactPath })).rejects.toThrow('does not match its reviewed artifact');
    } finally {
      await rm(artifactDir, { force: true, recursive: true });
    }
  });

  it('uses the main-trusted workflow, approval environment, and pinned Supabase CLI', async () => {
    const source = await readFile(resolve(root, '.github/workflows/production-trust-controls-migrations.yml'), 'utf8');
    const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as { devDependencies?: Record<string, string> };
    const workflow = parse(source) as Workflow;
    const migrate = workflow.jobs?.migrate;
    const migrationStep = migrate?.steps?.find((step) => step.run?.includes('node scripts/apply-production-trust-controls-migrations.mjs --dry-run'));
    const commands = migrationStep?.run?.split(/\r?\n/).map((command) => command.trim()).filter(Boolean) ?? [];
    const dryRunIndex = commands.indexOf('node scripts/apply-production-trust-controls-migrations.mjs --dry-run');
    const linkCommand = 'npx --no-install supabase link --project-ref vbdqjgwcmckutwehrbvo --yes';
    const artifactQueryCommand = 'npx --no-install supabase db query --linked --file supabase/production-trust-controls-054.sql';

    expect(source).toContain('production-trust-controls-migrations.yml@refs/heads/main');
    expect(migrate?.environment).toBe('production-trust-migrations');
    expect(packageJson.devDependencies?.supabase).toBe('2.109.1');
    expect(migrate?.env).toBeUndefined();
    expect(migrationStep?.env).toEqual({ SUPABASE_ACCESS_TOKEN: '${{ secrets.SUPABASE_ACCESS_TOKEN }}' });
    expect(dryRunIndex).toBeGreaterThanOrEqual(0);
    expect(commands.indexOf(linkCommand)).toBeGreaterThan(dryRunIndex);
    expect(commands.indexOf(artifactQueryCommand)).toBeGreaterThan(commands.indexOf(linkCommand));
    expect(commands.some((command) => /^npx\s+supabase\b/.test(command))).toBe(false);
    expect(source).not.toContain('PRODUCTION_DATABASE_URL');
  });
});
