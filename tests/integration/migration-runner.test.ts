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
  it('rejects duplicate migration version numbers', async () => {
    const migrationsDir = await mkdtemp(resolve(tmpdir(), 'balance-assist-migrations-'));
    temporaryDirectories.push(migrationsDir);
    await writeFile(resolve(migrationsDir, '001_first.sql'), 'select 1;');
    await writeFile(resolve(migrationsDir, '001_second.sql'), 'select 2;');

    const runner = await loadRunner();

    expect(() => runner.getIncrementalMigrations(migrationsDir)).toThrow(/Duplicate migration version 001/);
  });
});
