import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const LEGACY_SNAPSHOT = '000_full_schema.sql';

export function getIncrementalMigrations(migrationsDir) {
  const migrations = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql') && entry.name !== LEGACY_SNAPSHOT)
    .map((entry) => {
      const match = /^(\d+)_.+\.sql$/.exec(entry.name);
      if (!match) {
        throw new Error(`Migration filename must start with a numeric version: ${entry.name}`);
      }

      return {
        version: match[1],
        numericVersion: BigInt(match[1]),
        filename: entry.name,
        path: resolve(migrationsDir, entry.name)
      };
    });

  const versions = new Set();
  for (const migration of migrations) {
    if (versions.has(migration.numericVersion)) {
      throw new Error(`Duplicate migration version ${migration.version}`);
    }
    versions.add(migration.numericVersion);
  }

  return migrations
    .sort((left, right) => {
      if (left.numericVersion < right.numericVersion) return -1;
      if (left.numericVersion > right.numericVersion) return 1;
      return left.filename.localeCompare(right.filename);
    })
    .map(({ numericVersion, ...migration }) => migration);
}

export async function applyMigrations({
  connectionString = process.env.TEST_DATABASE_URL,
  migrationsDir = resolve(process.cwd(), 'supabase/migrations')
} = {}) {
  if (!connectionString) {
    throw new Error('TEST_DATABASE_URL is required. Set it to a disposable PostgreSQL database before running database migrations or tests.');
  }

  const migrations = getIncrementalMigrations(migrationsDir);
  const client = new Client({ connectionString });
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

    const recorded = await client.query('SELECT version, filename FROM public.schema_migrations');
    const recordedByVersion = new Map(recorded.rows.map((row) => [row.version, row.filename]));

    for (const migration of migrations) {
      const recordedFilename = recordedByVersion.get(migration.version);
      if (recordedFilename) {
        if (recordedFilename !== migration.filename) {
          throw new Error(`Migration version ${migration.version} is already recorded as ${recordedFilename}, not ${migration.filename}`);
        }
        continue;
      }

      await client.query(readFileSync(migration.path, 'utf8'));
      await client.query(
        'INSERT INTO public.schema_migrations (version, filename) VALUES ($1, $2)',
        [migration.version, migration.filename]
      );
      applied.push(migration.filename);
    }

    await client.query('COMMIT');
    return { applied };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  applyMigrations().then(
    ({ applied }) => {
      console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'No unapplied migrations.');
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    }
  );
}
