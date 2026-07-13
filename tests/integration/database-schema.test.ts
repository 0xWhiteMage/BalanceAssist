// @vitest-environment node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type MigrationResult = {
  applied: string[];
};

type MigrationRunner = {
  applyMigrations(options: {
    connectionString: string;
    migrationsDir: string;
    throughVersion?: string;
  }): Promise<MigrationResult>;
};

const connectionString = process.env.TEST_DATABASE_URL;
const migrationsDir = resolve(process.cwd(), 'supabase/migrations');
let client: import('pg').Client | undefined;
let serverSimulationClient: import('pg').Client | undefined;
let adminClient: import('pg').Client | undefined;
let rolelessConnectionString: string | undefined;
let grantConnectionString: string | undefined;
let rolelessMigration: MigrationResult | undefined;
let hardeningMigration: MigrationResult | undefined;
let publicRoleGrantsBeforeHardening: Array<Record<string, unknown>> | undefined;
const applicationTables = [
  'sessions',
  'events',
  'leads',
  'human_messages',
  'uploaded_files',
  'reference_links',
  'processed_telegram_updates',
  'handoff_outbox'
] as const;
const publicRoles = ['anon', 'authenticated'] as const;

async function loadRunner(): Promise<MigrationRunner> {
  return import(
    pathToFileURL(resolve(process.cwd(), 'scripts/apply-test-migrations.mjs')).href
  ) as Promise<MigrationRunner>;
}

function withDatabase(connection: string, database: string) {
  const url = new URL(connection);
  url.pathname = `/${database}`;
  return url.toString();
}

function serverSimulationConnection(connection: string) {
  const url = new URL(connection);
  url.username = 'server_role_simulation';
  url.password = 'test-service-role-password';
  return url.toString();
}

describe.skipIf(!connectionString)('database schema migrations', () => {
  beforeAll(async () => {
    const { Client } = await import('pg');
    const runner = await loadRunner();
    adminClient = new Client({ connectionString });
    await adminClient.connect();

    const roleCheck = await adminClient.query(
      "select rolname from pg_roles where rolname = any(array['anon', 'authenticated', 'server_role_simulation'])"
    );
    expect(roleCheck.rows).toEqual([]);

    const suffix = `${process.pid}_${Date.now()}`;
    const rolelessDatabase = `balance_assist_roleless_${suffix}`;
    const grantDatabase = `balance_assist_grants_${suffix}`;
    rolelessConnectionString = withDatabase(connectionString!, rolelessDatabase);
    grantConnectionString = withDatabase(connectionString!, grantDatabase);

    await adminClient.query(`create database ${rolelessDatabase}`);
    rolelessMigration = await runner.applyMigrations({
      connectionString: rolelessConnectionString,
      migrationsDir
    });

    // Plain PostgreSQL CI lacks Supabase roles. Create restricted API roles only after
    // the roleless migration proves 018's conditional grants are portable.
    await adminClient.query(`
      CREATE ROLE anon NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
      CREATE ROLE authenticated NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
      CREATE ROLE server_role_simulation LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS PASSWORD 'test-service-role-password';
      CREATE DATABASE ${grantDatabase};
    `);

    await runner.applyMigrations({
      connectionString: grantConnectionString,
      migrationsDir,
      throughVersion: '017'
    });
    await adminClient.query(`
      GRANT CONNECT ON DATABASE ${grantDatabase} TO server_role_simulation;
    `);

    const grantClient = new Client({ connectionString: grantConnectionString });
    await grantClient.connect();
    try {
      await grantClient.query(`
        GRANT USAGE ON SCHEMA public TO anon, authenticated, server_role_simulation;
        GRANT ALL PRIVILEGES ON TABLE
          public.sessions,
          public.events,
          public.leads,
          public.human_messages,
          public.uploaded_files,
          public.reference_links,
          public.processed_telegram_updates,
          public.handoff_outbox
        TO anon, authenticated, server_role_simulation;
      `);
      publicRoleGrantsBeforeHardening = (
        await grantClient.query(`
          select rolname as role_name,
                 has_schema_privilege(rolname, 'public', 'USAGE') as schema_usage,
                 has_table_privilege(rolname, 'public.sessions', 'SELECT') as table_select
          from pg_roles
          where rolname = any(array['anon', 'authenticated'])
          order by rolname
        `)
      ).rows;
    } finally {
      await grantClient.end();
    }

    hardeningMigration = await runner.applyMigrations({
      connectionString: grantConnectionString,
      migrationsDir
    });
    client = new Client({ connectionString: grantConnectionString });
    await client.connect();
    serverSimulationClient = new Client({ connectionString: serverSimulationConnection(grantConnectionString) });
    await serverSimulationClient.connect();
  });

  afterAll(async () => {
    await client?.end();
    await serverSimulationClient?.end();
    if (adminClient && rolelessConnectionString && grantConnectionString) {
      const rolelessDatabase = new URL(rolelessConnectionString).pathname.slice(1);
      const grantDatabase = new URL(grantConnectionString).pathname.slice(1);
      await adminClient.query(`drop database if exists ${rolelessDatabase}`);
      await adminClient.query(`drop database if exists ${grantDatabase}`);
      await adminClient.query('drop role if exists server_role_simulation, anon, authenticated');
    }
    await adminClient?.end();
  });

  it('applies the full chain, including 018, before public roles exist', () => {
    expect(rolelessMigration?.applied).toContain('018_public_schema_rls.sql');
  });

  it('applies only 018 after public roles receive representative grants', () => {
    expect(publicRoleGrantsBeforeHardening).toEqual([
      { role_name: 'anon', schema_usage: true, table_select: true },
      { role_name: 'authenticated', schema_usage: true, table_select: true }
    ]);
    expect(hardeningMigration?.applied).toEqual(['018_public_schema_rls.sql']);
  });

  it('creates the required current tables', async () => {
    const result = await client!.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[])",
      [['sessions', 'events', 'leads', 'human_messages', 'uploaded_files', 'reference_links', 'processed_telegram_updates', 'handoff_outbox']]
    );

    expect(result.rows.map((row) => row.table_name).sort()).toEqual([
      'events',
      'handoff_outbox',
      'human_messages',
      'leads',
      'processed_telegram_updates',
      'reference_links',
      'sessions',
      'uploaded_files'
    ]);
  });

  it('enables RLS and denies direct table privileges to public API roles', async () => {
    const rls = await client!.query(
      `select relname, relrowsecurity
       from pg_class
       where oid = any($1::regclass[])
       order by relname`,
      [applicationTables.map((table) => `public.${table}`)]
    );
    const privileges = await client!.query(
      `select role_name, table_name, privilege_type
       from unnest($1::text[]) as roles(role_name)
       cross join unnest($2::text[]) as tables(table_name)
       cross join unnest($3::text[]) as privileges(privilege_type)
       where has_table_privilege(role_name, format('public.%I', table_name), privilege_type)
       order by role_name, table_name, privilege_type`,
      [
        publicRoles,
        applicationTables,
        ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
      ]
    );

    expect(rls.rows).toEqual(
      applicationTables
        .slice()
        .sort()
        .map((relname) => ({ relname, relrowsecurity: true }))
    );
    expect(privileges.rows).toEqual([]);
  });

  it('creates no policies on application tables', async () => {
    const policies = await client!.query(
      `select tablename, policyname
       from pg_policies
       where schemaname = 'public' and tablename = any($1::text[])
       order by tablename, policyname`,
      [applicationTables]
    );

    expect(policies.rows).toEqual([]);
  });

  it('denies anonymous and authenticated roles', async () => {
    for (const role of publicRoles) {
      await client!.query(`set role ${role}`);
      await expect(client!.query('select 1 from public.sessions limit 1')).rejects.toThrow();
      await expect(
        client!.query("insert into public.sessions (source_url) values ('https://example.test')")
      ).rejects.toThrow();
      await client!.query('reset role');
    }
  });

  it('allows the restricted server-role simulation to access application tables', async () => {
    const inserted = await serverSimulationClient!.query(
      "insert into public.sessions (source_url) values ('https://example.test') returning id"
    );
    await serverSimulationClient!.query('delete from public.sessions where id = $1', [inserted.rows[0].id]);
  });

  it('creates the required current columns', async () => {
    const result = await client!.query(
      "select table_name, column_name from information_schema.columns where table_schema = 'public' and (table_name, column_name) in (('sessions', 'capability_hash'), ('sessions', 'capability_expires_at'), ('sessions', 'consent_version'), ('sessions', 'consented_at'), ('sessions', 'draft'), ('sessions', 'draft_version'), ('leads', 'idempotency_key'), ('uploaded_files', 'original_name'), ('uploaded_files', 'mime_type'), ('uploaded_files', 'status'), ('uploaded_files', 'storage_path'), ('processed_telegram_updates', 'update_id'), ('processed_telegram_updates', 'received_at'), ('handoff_outbox', 'idempotency_key'), ('handoff_outbox', 'claim_expires_at'))"
    );

    expect(result.rows.map((row) => `${row.table_name}.${row.column_name}`).sort()).toEqual([
      'handoff_outbox.claim_expires_at',
      'handoff_outbox.idempotency_key',
      'leads.idempotency_key',
      'processed_telegram_updates.received_at',
      'processed_telegram_updates.update_id',
      'sessions.capability_expires_at',
      'sessions.capability_hash',
      'sessions.consent_version',
      'sessions.consented_at',
      'sessions.draft',
      'sessions.draft_version',
      'uploaded_files.mime_type',
      'uploaded_files.original_name',
      'uploaded_files.status',
      'uploaded_files.storage_path'
    ]);
  });

  it('does not reapply recorded migrations', async () => {
    const runner = await loadRunner();
    const result = await runner.applyMigrations({ connectionString: connectionString!, migrationsDir });
    const recorded = await client!.query(
      "select version, filename from public.schema_migrations order by version"
    );

    expect(result.applied).toEqual([]);
    expect(recorded.rows.map((row) => `${row.version}:${row.filename}`)).toEqual([
      '001:001_initial_schema.sql',
      '002:002_human_messages.sql',
      '003:003_telegram_topics.sql',
      '004:004_contact_capture.sql',
      '006:006_human_file_request_state.sql',
      '007:007_uploaded_files.sql',
      '008:008_schedule_request.sql',
      '009:009_brief_attachments.sql',
      '010:010_uploaded_files_telegram_metadata.sql',
      '011:011_reference_links_table.sql',
      '012:012_reference_links_session_nullable.sql',
      '013:013_uploaded_files_relax_legacy_constraints.sql',
      '014:014_trust_security_foundation.sql',
      '015:015_trust_delivery_outbox.sql',
      '016:016_uploaded_files_metadata_alignment.sql',
      '017:017_handoff_claim_leases.sql',
      '018:018_public_schema_rls.sql'
    ]);
  });
});
