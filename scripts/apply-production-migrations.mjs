import { applyMigrations, getIncrementalMigrations } from './apply-test-migrations.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const policyBaseline = 37n;

export function assertExpandOnlyMigration(source, filename) {
  if (/--|\/\*|\*\//.test(source)) {
    throw new Error(`${filename} is not expand-only: contains comments; use the separately approved cleanup migration workflow.`);
  }

  const identifier = '[a-z_][a-z0-9_]*';
  const qualifiedIdentifier = `(?:${identifier}\\.)?${identifier}`;
  const type = '(?:text|uuid|boolean|integer|bigint|numeric(?:\\(\\d+(?:\\s*,\\s*\\d+)?\\))?|varchar\\(\\d+\\)|timestamptz|jsonb)';
  const defaultValue = "(?:null|true|false|[-+]?\\d+(?:\\.\\d+)?|'(?:[^']|'')*')";
  const constraints = `(?:\\s+(?:primary\\s+key|not\\s+null|unique|default\\s+${defaultValue}))*`;
  const column = `${identifier}\\s+${type}${constraints}`;
  const createTable = new RegExp(`^create\\s+table\\s+if\\s+not\\s+exists\\s+${qualifiedIdentifier}\\s*\\(\\s*${column}(?:\\s*,\\s*${column})*\\s*\\)\\s*;$`, 'i');
  const addColumn = new RegExp(`^alter\\s+table\\s+${qualifiedIdentifier}\\s+add\\s+column\\s+if\\s+not\\s+exists\\s+${column}\\s*;$`, 'i');
  const createIndex = new RegExp(`^create\\s+(?:unique\\s+)?index\\s+if\\s+not\\s+exists\\s+${identifier}\\s+on\\s+${qualifiedIdentifier}\\s*\\(\\s*${identifier}(?:\\s*,\\s*${identifier})*\\s*\\)\\s*;$`, 'i');

  if (!createTable.test(source) && !addColumn.test(source) && !createIndex.test(source)) {
    throw new Error(`${filename} is not expand-only: contains unsupported SQL; use the separately approved cleanup migration workflow.`);
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
