import { applyMigrations, getIncrementalMigrations } from './apply-test-migrations.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const policyBaseline = 37n;

export function assertExpandOnlyMigration(source, filename) {
  const destructive = /\b(DROP|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE[\s\S]*\bRENAME\b|ALTER\s+TABLE[\s\S]*\bALTER\s+COLUMN\b[\s\S]*\b(TYPE|SET\s+NOT\s+NULL|DROP)\b)\b/i;
  if (destructive.test(source)) {
    throw new Error(`${filename} is not expand-only; use the separately approved cleanup migration workflow.`);
  }
}

export async function applyProductionMigrations(connectionString = process.env.PRODUCTION_DATABASE_URL) {
  if (!connectionString) {
    throw new Error('PRODUCTION_DATABASE_URL is required in the protected production-migrations environment.');
  }

  const migrations = getIncrementalMigrations(resolve(process.cwd(), 'supabase/migrations'));
  for (const migration of migrations) {
    if (BigInt(migration.version) > policyBaseline) {
      assertExpandOnlyMigration(readFileSync(migration.path, 'utf8'), migration.filename);
    }
  }

  const { applied } = await applyMigrations({ connectionString });
  return { applied, schemaVersion: migrations.at(-1)?.version };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  applyProductionMigrations().then((result) => console.log(JSON.stringify(result)));
}
