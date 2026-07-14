import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { getIncrementalMigrations } from './apply-test-migrations.mjs';

export const recoveryMigrationVersions = Array.from(
  { length: 19 },
  (_, index) => String(index + 19).padStart(3, '0')
);

export function selectRecoveryMigrations(migrations) {
  const byVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  return recoveryMigrationVersions.map((version) => {
    const migration = byVersion.get(version);
    if (!migration) throw new Error(`missing recovery migration ${version}`);
    return migration;
  });
}

export function assertRecoveryRangeIsEmpty(recordedVersions) {
  const recorded = new Set(recordedVersions.map(String));
  const existing = recoveryMigrationVersions.find((version) => recorded.has(version));
  if (existing) throw new Error(`recovery migration ${existing} is already recorded; this runner requires an empty 019-037 range`);
}

export function assertRecoveryRecords(records, migrations) {
  if (records.length !== migrations.length) {
    throw new Error(`recovery migration verification failed: expected ${migrations.length} records, got ${records.length}`);
  }

  for (const [index, migration] of migrations.entries()) {
    const record = records[index];
    if (record?.version !== migration.version || record?.filename !== migration.filename) {
      throw new Error(`recovery migration verification failed for version ${migration.version}`);
    }
  }
}

export function serializeRecoveryError() {
  return JSON.stringify({ error: { message: 'Production migration recovery failed.' } });
}

export async function recoverProductionMigrations({
  connectionString = process.env.PRODUCTION_DATABASE_URL,
  migrationsDir = resolve(process.cwd(), 'supabase/migrations'),
  createClient = (url) => new Client({ connectionString: url })
} = {}) {
  if (!connectionString) {
    throw new Error('PRODUCTION_DATABASE_URL is required in the protected production-recovery environment.');
  }

  const migrations = selectRecoveryMigrations(getIncrementalMigrations(migrationsDir));
  const client = createClient(connectionString);
  const applied = [];

  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version text PRIMARY KEY,
        filename text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows: existing } = await client.query(
      'SELECT version FROM public.schema_migrations WHERE version = ANY($1::text[])',
      [recoveryMigrationVersions]
    );
    assertRecoveryRangeIsEmpty(existing.map((record) => record.version));

    for (const migration of migrations) {
      await client.query(readFileSync(migration.path, 'utf8'));
      await client.query(
        'INSERT INTO public.schema_migrations (version, filename) VALUES ($1, $2)',
        [migration.version, migration.filename]
      );
      applied.push(migration.filename);
    }

    const { rows: records } = await client.query(
      'SELECT version, filename FROM public.schema_migrations WHERE version = ANY($1::text[]) ORDER BY version',
      [recoveryMigrationVersions]
    );
    assertRecoveryRecords(records, migrations);
    await client.query('COMMIT');

    return {
      applied,
      recordedVersions: records.map((record) => record.version),
      schemaVersion: recoveryMigrationVersions.at(-1)
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  recoverProductionMigrations().then(
    (result) => console.log(JSON.stringify(result)),
    () => {
      console.error(serializeRecoveryError());
      process.exitCode = 1;
    }
  );
}
