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

type MigrationRunner = {
  getIncrementalMigrations(migrationsDir: string): Migration[];
};

const temporaryDirectories: string[] = [];

async function loadRunner(): Promise<MigrationRunner> {
  return import(
    pathToFileURL(resolve(process.cwd(), 'scripts/apply-test-migrations.mjs')).href
  ) as Promise<MigrationRunner>;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('test migration runner', () => {
  it('orders migrations by numeric version', async () => {
    const migrationsDir = await mkdtemp(resolve(tmpdir(), 'balance-assist-migrations-'));
    temporaryDirectories.push(migrationsDir);
    await writeFile(resolve(migrationsDir, '1000_after.sql'), 'select 1;');
    await writeFile(resolve(migrationsDir, '2_second.sql'), 'select 2;');
    await writeFile(resolve(migrationsDir, '999_before.sql'), 'select 3;');
    await writeFile(resolve(migrationsDir, '10_tenth.sql'), 'select 4;');

    const runner = await loadRunner();

    expect(runner.getIncrementalMigrations(migrationsDir).map((migration) => migration.filename)).toEqual([
      '2_second.sql',
      '10_tenth.sql',
      '999_before.sql',
      '1000_after.sql'
    ]);
  });

  it('rejects differently padded duplicate numeric migration versions', async () => {
    const migrationsDir = await mkdtemp(resolve(tmpdir(), 'balance-assist-migrations-'));
    temporaryDirectories.push(migrationsDir);
    await writeFile(resolve(migrationsDir, '002_first.sql'), 'select 1;');
    await writeFile(resolve(migrationsDir, '2_second.sql'), 'select 2;');

    const runner = await loadRunner();

    expect(() => runner.getIncrementalMigrations(migrationsDir)).toThrow(/Duplicate migration version 2/);
  });

  it('rejects duplicate migration version numbers', async () => {
    const migrationsDir = await mkdtemp(resolve(tmpdir(), 'balance-assist-migrations-'));
    temporaryDirectories.push(migrationsDir);
    await writeFile(resolve(migrationsDir, '001_first.sql'), 'select 1;');
    await writeFile(resolve(migrationsDir, '001_second.sql'), 'select 2;');

    const runner = await loadRunner();

    expect(() => runner.getIncrementalMigrations(migrationsDir)).toThrow(/Duplicate migration version 001/);
  });
});
