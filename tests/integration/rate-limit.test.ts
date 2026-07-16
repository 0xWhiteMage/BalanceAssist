// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type MigrationRunner = {
  applyMigrations(options: { connectionString: string; migrationsDir: string; bootstrapStorage?: boolean }): Promise<unknown>;
};

const connectionString = process.env.TEST_DATABASE_URL;
const migrationsDir = resolve(process.cwd(), 'supabase/migrations');
let admin: import('pg').Client | undefined;
let client: import('pg').Client | undefined;
let databaseName: string | undefined;
let databaseUrl: string | undefined;
const createdRoles: string[] = [];

function databaseConnection(connection: string, database: string) {
  const url = new URL(connection);
  url.pathname = `/${database}`;
  return url.toString();
}

async function loadRunner(): Promise<MigrationRunner> {
  return import(pathToFileURL(resolve(process.cwd(), 'scripts/apply-test-migrations.mjs')).href) as Promise<MigrationRunner>;
}

describe.skipIf(!connectionString)('rate-limit database boundary', () => {
  beforeAll(async () => {
    const { Client } = await import('pg');
    admin = new Client({ connectionString });
    await admin.connect();
    databaseName = `balance_assist_rate_limit_${process.pid}_${Date.now()}`;
    databaseUrl = databaseConnection(connectionString!, databaseName);

    for (const role of ['anon', 'authenticated', 'service_role']) {
      const exists = await admin.query('select 1 from pg_roles where rolname = $1', [role]);
      if (exists.rowCount === 0) {
        await admin.query(`create role ${role} noinherit nologin nosuperuser nocreatedb nocreaterole noreplication`);
        createdRoles.push(role);
      }
    }

    await admin.query(`create database ${databaseName}`);
    const runner = await loadRunner();
    await runner.applyMigrations({ connectionString: databaseUrl, migrationsDir, bootstrapStorage: true });
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
    if (admin && databaseName) await admin.query(`drop database if exists ${databaseName}`);
    for (const role of createdRoles) await admin?.query(`drop role if exists ${role}`);
    await admin?.end();
  });

  it('denies limiter RPC execution to public API roles and allows the server role', async () => {
    for (const role of ['anon', 'authenticated']) {
      await client!.query(`set role ${role}`);
      await expect(client!.query("select * from public.consume_api_rate_limit(repeat('a', 64), 5, 60)")).rejects.toThrow();
      await client!.query('reset role');
    }

    await client!.query('set role service_role');
    await expect(client!.query("select * from public.consume_api_rate_limit(repeat('b', 64), 5, 60)")).resolves.toMatchObject({
      rows: [{ permitted: true, retry_after_seconds: 0 }]
    });
    await client!.query('reset role');
  });

  it('creates the retention index and prunes expired rows in bounded batches', async () => {
    await client!.query(`
      insert into public.api_rate_limits (key_hash, window_started_at, request_count, updated_at)
      select lpad(value::text, 64, 'c'), now() - interval '8 days', 1, now() - interval '8 days'
      from generate_series(1, 3) as value
    `);

    expect(await client!.query("select indexname from pg_indexes where schemaname = 'public' and tablename = 'api_rate_limits' and indexname = 'api_rate_limits_updated_at_idx'"))
      .toMatchObject({ rows: [{ indexname: 'api_rate_limits_updated_at_idx' }] });
    await expect(client!.query('select public.prune_api_rate_limits(2) as deleted')).resolves.toMatchObject({ rows: [{ deleted: 2 }] });
    await expect(client!.query('select public.prune_api_rate_limits(2) as deleted')).resolves.toMatchObject({ rows: [{ deleted: 1 }] });
  });

  it('consumes a bucket atomically across concurrent connections', async () => {
    const { Client } = await import('pg');
    const clients = await Promise.all(Array.from({ length: 10 }, async () => {
      const concurrent = new Client({ connectionString: databaseUrl! });
      await concurrent.connect();
      return concurrent;
    }));
    const results = await Promise.all(clients.map((concurrent) =>
      concurrent.query("select * from public.consume_api_rate_limit(repeat('d', 64), 5, 60)")
    ));
    await Promise.all(clients.map((concurrent) => concurrent.end()));

    expect(results.filter((result) => result.rows[0].permitted).length).toBe(5);
    expect(results.filter((result) => !result.rows[0].permitted).length).toBe(5);
  });
});
