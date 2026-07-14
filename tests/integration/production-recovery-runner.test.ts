// @vitest-environment node

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

type Migration = {
  version: string;
  filename: string;
  path: string;
};

type Query = {
  text: string;
  values?: unknown[];
};

type RecoveryRunner = {
  recoveryMigrationVersions: string[];
  selectRecoveryMigrations(migrations: Migration[]): Migration[];
  assertRecoveryRangeIsEmpty(recordedVersions: string[]): void;
  recoverProductionMigrations(options: {
    connectionString: string;
    migrationsDir: string;
    createClient(connectionString: string): {
      connect(): Promise<void>;
      end(): Promise<void>;
      query(text: string, values?: unknown[]): Promise<{ rows: { version: string; filename?: string }[] }>;
    };
  }): Promise<{ applied: string[]; recordedVersions: string[]; schemaVersion: string }>;
};

const temporaryDirectories: string[] = [];
const versions = Array.from({ length: 19 }, (_, index) => String(index + 19).padStart(3, '0'));

async function loadRunner(): Promise<RecoveryRunner> {
  return import(
    pathToFileURL(resolve(process.cwd(), 'scripts/recover-production-migrations.mjs')).href
  ) as Promise<RecoveryRunner>;
}

async function createMigrationsDir() {
  const migrationsDir = await mkdtemp(resolve(tmpdir(), 'balance-assist-recovery-migrations-'));
  temporaryDirectories.push(migrationsDir);
  for (const version of [...versions, '038', '039', '040', '041', '042', '043']) {
    await writeFile(resolve(migrationsDir, `${version}_migration.sql`), `SELECT '${version}';`);
  }
  return migrationsDir;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('production recovery runner', () => {
  it('selects precisely the approved 019 through 037 range', async () => {
    const migrationsDir = await createMigrationsDir();
    const runner = await loadRunner();
    const migrations = (await import(pathToFileURL(resolve(process.cwd(), 'scripts/apply-test-migrations.mjs')).href))
      .getIncrementalMigrations(migrationsDir) as Migration[];

    expect(runner.recoveryMigrationVersions).toEqual(versions);
    expect(runner.selectRecoveryMigrations(migrations).map(({ version }) => version)).toEqual(versions);
    expect(runner.selectRecoveryMigrations(migrations).map(({ filename }) => filename)).not.toContain('038_migration.sql');
  });

  it('rejects an incomplete recovery range and pre-existing tracker entries', async () => {
    const runner = await loadRunner();

    expect(() => runner.selectRecoveryMigrations([])).toThrow('missing recovery migration 019');
    expect(() => runner.assertRecoveryRangeIsEmpty(['018', '021', '038'])).toThrow('021 is already recorded');
  });

  it('applies and records every approved migration in one verified transaction', async () => {
    const migrationsDir = await createMigrationsDir();
    const runner = await loadRunner();
    const queries: Query[] = [];
    const client = {
      connect: async () => undefined,
      end: async () => undefined,
      query: async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        if (text === 'SELECT version FROM public.schema_migrations WHERE version = ANY($1::text[])') return { rows: [] };
        if (text === 'SELECT version, filename FROM public.schema_migrations WHERE version = ANY($1::text[]) ORDER BY version') {
          return { rows: versions.map((version) => ({ version, filename: `${version}_migration.sql` })) };
        }
        return { rows: [] };
      }
    };

    const result = await runner.recoverProductionMigrations({
      connectionString: 'postgres://not-a-live-database',
      migrationsDir,
      createClient: () => client
    });

    expect(result).toEqual({
      applied: versions.map((version) => `${version}_migration.sql`),
      recordedVersions: versions,
      schemaVersion: '037'
    });
    expect(queries.map(({ text }) => text)).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']));
    expect(queries.filter(({ text }) => text.startsWith('INSERT INTO public.schema_migrations'))).toHaveLength(19);
    expect(queries.findIndex(({ text }) => text === 'COMMIT')).toBeGreaterThan(
      queries.findIndex(({ text }) => text === 'SELECT version, filename FROM public.schema_migrations WHERE version = ANY($1::text[]) ORDER BY version')
    );
  });

  it('rolls back when a migration cannot be applied', async () => {
    const migrationsDir = await createMigrationsDir();
    const runner = await loadRunner();
    const queries: Query[] = [];
    const client = {
      connect: async () => undefined,
      end: async () => undefined,
      query: async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        if (text === 'SELECT version FROM public.schema_migrations WHERE version = ANY($1::text[])') return { rows: [] };
        if (text === "SELECT '029';") throw new Error('migration failed');
        return { rows: [] };
      }
    };

    await expect(runner.recoverProductionMigrations({
      connectionString: 'postgres://not-a-live-database',
      migrationsDir,
      createClient: () => client
    })).rejects.toThrow('migration failed');

    expect(queries.map(({ text }) => text)).toContain('ROLLBACK');
    expect(queries.map(({ text }) => text)).not.toContain('COMMIT');
  });
});
