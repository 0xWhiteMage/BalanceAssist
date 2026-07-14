// @vitest-environment node

import { describe, expect, it } from 'vitest';
import * as productionMigrations from '../../scripts/apply-production-migrations.mjs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const { assertExpandOnlyMigration } = productionMigrations;

describe('production migration policy', () => {
  it('exposes a cleanup migration preflight policy', () => {
    expect(productionMigrations.assertReviewedCleanupMigrationsRecorded).toBeTypeOf('function');
  });

  it('allows reviewed cleanup migrations only when every version is already recorded', () => {
    const recordedVersions = ['038', '039', '040', '041', '042'];

    expect(() => productionMigrations.assertReviewedCleanupMigrationsRecorded(recordedVersions)).not.toThrow();
    expect(() => productionMigrations.assertReviewedCleanupMigrationsRecorded(recordedVersions.filter((version) => version !== '040')))
      .toThrow('040 is pending; run Production cleanup migrations before this release');
  });

  it('queries the migration tracker before evaluating production migration files', async () => {
    const source = await readFile(resolve(process.cwd(), 'scripts/apply-production-migrations.mjs'), 'utf8');

    expect(source).toContain("await client.query('SELECT version FROM public.schema_migrations')");
    expect(source.indexOf("await client.query('SELECT version FROM public.schema_migrations')"))
      .toBeLessThan(source.indexOf('for (const migration of migrations)'));
  });

  it('rejects destructive schema and data operations from protected releases', () => {
    expect(() => assertExpandOnlyMigration('DROP TABLE public.sessions;', '999_cleanup.sql')).toThrow('expand-only');
    expect(() => assertExpandOnlyMigration('ALTER TABLE public.sessions DROP COLUMN draft;', '999_cleanup.sql')).toThrow('expand-only');
    expect(() => assertExpandOnlyMigration('DELETE FROM public.sessions;', '999_cleanup.sql')).toThrow('expand-only');
    expect(() => assertExpandOnlyMigration('/* DROP TABLE public.sessions; */ ALTER TABLE public.sessions ADD COLUMN safe text;', '999_cleanup.sql')).toThrow('comments');
    expect(() => assertExpandOnlyMigration('ALTER TABLE public.sessions ADD COLUMN safe text; DELETE FROM public.sessions;', '999_cleanup.sql')).toThrow('unsupported');
    expect(() => assertExpandOnlyMigration('ALTER TABLE public.sessions ADD COLUMN safe text DEFAULT (select secret from private.values);', '999_cleanup.sql')).toThrow('unsupported');
    expect(() => assertExpandOnlyMigration('CREATE FUNCTION public.erase() RETURNS void LANGUAGE sql AS $$ DELETE FROM public.sessions; $$;', '999_cleanup.sql')).toThrow('unsupported');
  });

  it('allows an additive forward migration', () => {
    expect(() => assertExpandOnlyMigration('ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS release_note text;', '999_additive.sql')).not.toThrow();
  });

  it('permits only one supported additive statement', () => {
    expect(() => assertExpandOnlyMigration('CREATE INDEX IF NOT EXISTS sessions_release_note_idx ON public.sessions (release_note);', '999_additive.sql')).not.toThrow();
    expect(() => assertExpandOnlyMigration('CREATE TABLE IF NOT EXISTS public.release_notes (id uuid PRIMARY KEY);', '999_additive.sql')).not.toThrow();
  });

  it('identifies the protected cleanup workflow as the prerequisite for reviewed destructive versions', () => {
    expect(() => assertExpandOnlyMigration('DELETE FROM public.deletion_jobs;', '038_durable_deletion_jobs.sql'))
      .toThrow('Production cleanup migrations');
    expect(() => assertExpandOnlyMigration('DROP TABLE public.deletion_jobs;', '042_deletion_recovery_ownership.sql'))
      .toThrow('038-042');
  });
});
