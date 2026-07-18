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

type Query = {
  text: string;
  values?: unknown[];
};

type RecoveryRunner = {
  recoveryMigrationVersions: string[];
  selectRecoveryMigrations(migrations: Migration[]): Migration[];
  assertRecoveryRangeIsEmpty(recordedVersions: string[]): void;
  serializeRecoveryError(error: unknown): string;
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
const normalizeNewlines = (value: string) => value.replace(/\r\n?/g, '\n');

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
  it('keeps the SQL Editor fallback transactional, source-verified, and storage-neutral', async () => {
    const artifact = normalizeNewlines(await readFile(resolve(process.cwd(), 'supabase/production-recovery-019-037.sql'), 'utf8'));
    const documentation = (await readFile(resolve(process.cwd(), 'docs/private-attachment-storage.md'), 'utf8')).replace(/\r\n/g, '\n');
    const migrations = (await import(pathToFileURL(resolve(process.cwd(), 'scripts/apply-test-migrations.mjs')).href))
      .getIncrementalMigrations(resolve(process.cwd(), 'supabase/migrations')) as Migration[];
    const recoveryMigrations = migrations.filter(({ version }) => BigInt(version) >= 19n && BigInt(version) <= 37n);
    const excludedMigrations = migrations.filter(({ version }) => BigInt(version) >= 38n && BigInt(version) <= 43n);

    expect(artifact).toMatch(/^-- SQL Editor fallback only; not for cleanup\.\r?\n-- Do not directly manage Supabase Storage relations or buckets\.\r?\n/);
    const begin = artifact.indexOf('BEGIN;');
    const baselinePreflight = artifact.slice(0, begin);
    expect(begin).toBeGreaterThan(0);
    expect(baselinePreflight).toContain("WHERE version = '018'");
    expect(baselinePreflight).toContain("RAISE EXCEPTION 'verified 001-018 baseline is required; stop and do not run this recovery script'");
    for (const relation of ['sessions', 'handoff_outbox', 'uploaded_files', 'human_messages', 'leads']) {
      expect(baselinePreflight).toContain(`'public.${relation}'`);
    }
    expect(baselinePreflight).toContain('WHERE to_regclass(required_relation) IS NULL');
    for (const column of ['sessions.id', 'sessions.draft', 'handoff_outbox.claim_expires_at', 'uploaded_files.status', 'human_messages.telegram_thread_id', 'leads.idempotency_key']) {
      expect(baselinePreflight).toContain(`'${column}'`);
    }
    expect(baselinePreflight).toContain("to_regprocedure('public.set_updated_at()')");
    expect(baselinePreflight).toContain("to_regprocedure('gen_random_uuid()')");
    expect(artifact).toContain('CREATE TABLE IF NOT EXISTS public.schema_migrations');
    expect(artifact).toContain("RAISE EXCEPTION 'recovery migrations 019-037 are already recorded: %'");

    const firstSourceSection = artifact.indexOf('-- BEGIN 019_api_rate_limits.sql');
    expect(artifact.indexOf('BEGIN;')).toBeLessThan(firstSourceSection);
    expect(artifact.indexOf('CREATE TABLE IF NOT EXISTS public.schema_migrations')).toBeLessThan(firstSourceSection);
    expect(artifact.indexOf("RAISE EXCEPTION 'recovery migrations 019-037 are already recorded: %'")).toBeLessThan(firstSourceSection);

    for (const migration of recoveryMigrations) {
      const source = normalizeNewlines(await readFile(migration.path, 'utf8'));
      const section = new RegExp(
        `-- BEGIN ${migration.filename.replace('.', '\\.')}\\r?\\n-- =+\\r?\\n([\\s\\S]*?)-- END ${migration.filename.replace('.', '\\.')}\\r?\\n`
      ).exec(artifact);

      expect(section?.[1]).toBe(source);
    }
    expect(recoveryMigrations.map(({ filename }) => artifact.indexOf(`-- BEGIN ${filename}`))).toEqual(
      [...recoveryMigrations.map(({ filename }) => artifact.indexOf(`-- BEGIN ${filename}`))].sort((left, right) => left - right)
    );
    expect((artifact.match(/-- BEGIN 0(?:19|2[0-9]|3[0-7])_/g) ?? [])).toHaveLength(19);

    for (const migration of excludedMigrations) {
      const source = normalizeNewlines(await readFile(migration.path, 'utf8'));
      expect(artifact).not.toContain(migration.filename);
      expect(artifact).not.toContain(source);
    }

    const trackerInsert = /INSERT INTO public\.schema_migrations \(version, filename\)\r?\nVALUES\r?\n([\s\S]*?);/.exec(artifact);
    const trackerMappings = [...(trackerInsert?.[1].matchAll(/\('([^']+)', '([^']+)'\)/g) ?? [])]
      .map(([, version, filename]) => ({ version, filename }));
    expect(trackerMappings).toEqual(recoveryMigrations.map(({ version, filename }) => ({ version, filename })));
    expect(trackerInsert?.[0]).not.toContain('ON CONFLICT');
    const postconditionStart = artifact.indexOf('DO $$', (trackerInsert?.index ?? 0) + (trackerInsert?.[0].length ?? 0));
    const postconditionFailure = artifact.indexOf("RAISE EXCEPTION 'schema_migrations verification failed for 019-037'", postconditionStart);
    const commit = artifact.lastIndexOf('COMMIT;');
    expect(postconditionStart).toBeGreaterThan((trackerInsert?.index ?? 0) + (trackerInsert?.[0].length ?? 0));
    expect(postconditionFailure).toBeGreaterThan(postconditionStart);
    expect(postconditionFailure).toBeLessThan(commit);
    expect(artifact.lastIndexOf('COMMIT;')).toBe(artifact.trimEnd().length - 'COMMIT;'.length);
    expect(artifact.match(/COMMIT;/g)).toHaveLength(1);
    expect(artifact).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM|CREATE|ALTER|DROP)\s+storage\./i);

    const baselineVerification = documentation.indexOf('1. Run the baseline verification query below.');
    const runArtifact = documentation.indexOf('2. Run `supabase/production-recovery-019-037.sql` in the Supabase SQL Editor.');
    const successfulCommit = documentation.indexOf('3. Continue only after it commits successfully with no errors.');
    const createBucket = documentation.indexOf('4. Create `temporary-attachments` in the Supabase Storage dashboard with public access disabled.');
    const verification = documentation.indexOf('5. Run the read-only verification query below.');
    expect(baselineVerification).toBeGreaterThan(-1);
    expect(runArtifact).toBeGreaterThan(baselineVerification);
    expect(successfulCommit).toBeGreaterThan(runArtifact);
    expect(createBucket).toBeGreaterThan(successfulCommit);
    expect(verification).toBeGreaterThan(createBucket);
    expect(documentation).toContain('Do not add browser Storage policies.');
    expect(documentation).toContain('Pass only when the tracker query returns exactly 19 rows for 019-037 and every filename matches the expected migration filename.');
    expect(documentation).toContain('Pass only when the bucket query returns exactly one row with `public = false`.');
    expect(documentation).toContain('Pass only when the policy query returns zero rows and the readiness query returns `true`.');
    expect(documentation).toContain('On any failure, stop. Do not retry blindly and do not apply migrations 038-043.');
    expect(documentation).toContain("SELECT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '018') AS tracker_018_recorded;");
    expect(documentation).toContain("SELECT 'public.sessions' AS required_relation");
    expect(documentation).toContain("SELECT 'sessions.id' AS required_column");
    expect(documentation).toContain('Pass only when `tracker_018_recorded` is true and the relation, column, and function checks return zero rows.');
    expect(documentation).toContain("SELECT 'public.set_updated_at()' AS required_function");
    expect(documentation).toContain("SELECT version, filename\nFROM public.schema_migrations\nWHERE version BETWEEN '019' AND '037'\nORDER BY version;");
    expect(documentation).toContain("SELECT id, name, public\nFROM storage.buckets\nWHERE id = 'temporary-attachments';");
    expect(documentation).toContain('WITH RECURSIVE memberships(browser_role, role_oid) AS');
    expect(documentation).toContain("WHERE schemaname = 'storage'\n  AND tablename = 'objects'");
    expect(documentation).toContain("'public'::name = ANY(roles) OR EXISTS");
    expect(documentation).toContain('SELECT 1 FROM role_names WHERE role_name = ANY(roles)');
    expect(documentation).toContain("SELECT public.private_attachment_storage_is_ready('temporary-attachments');");
  });

  it('labels the production bundle as source evidence while preserving every source section', async () => {
    const bundle = normalizeNewlines(await readFile(resolve(process.cwd(), 'supabase/production-migrations-019-043.sql'), 'utf8'));
    const migrations = (await import(pathToFileURL(resolve(process.cwd(), 'scripts/apply-test-migrations.mjs')).href))
      .getIncrementalMigrations(resolve(process.cwd(), 'supabase/migrations')) as Migration[];

    expect(bundle).toContain('source-evidence bundle, NOT a production recovery command');
    expect(bundle).toContain('scripts/recover-production-migrations.mjs');
    expect(bundle).toContain('approved 019-037');
    expect(bundle).toContain('038-043 require their protected workflow');
    for (const migration of migrations.filter(({ version }) => BigInt(version) >= 19n && BigInt(version) <= 43n)) {
      const source = normalizeNewlines(await readFile(migration.path, 'utf8'));
      const section = new RegExp(
        `-- BEGIN ${migration.filename.replace('.', '\\.')}\\r?\\n-- =+\\r?\\n([\\s\\S]*?)\\r?\\n-- END ${migration.filename.replace('.', '\\.')}\\r?\\n`
      ).exec(bundle);

      expect(section?.[1].trimEnd()).toBe(source.trimEnd());
    }
  });

  it('serializes failures as safe JSON without error details', async () => {
    const runner = await loadRunner();
    const secret = 'postgres://operator:super-secret@db.example.test:5432/app?password=super-secret';

    const output = runner.serializeRecoveryError(new Error(`connection failed: ${secret}`));

    expect(JSON.parse(output)).toEqual({ error: { message: 'Production migration recovery failed.' } });
    expect(output).not.toContain(secret);
    expect(output).not.toContain('super-secret');
  });

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
