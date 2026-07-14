import { applyMigrations, getIncrementalMigrations } from './apply-test-migrations.mjs';
import { resolve } from 'node:path';

const connectionString = process.env.PRODUCTION_DATABASE_URL;

if (!connectionString) {
  throw new Error('PRODUCTION_DATABASE_URL is required in the protected production-migrations environment.');
}

const { applied } = await applyMigrations({ connectionString });
const migrations = getIncrementalMigrations(resolve(process.cwd(), 'supabase/migrations'));
const schemaVersion = migrations.at(-1)?.version;

console.log(JSON.stringify({ applied, schemaVersion }));
