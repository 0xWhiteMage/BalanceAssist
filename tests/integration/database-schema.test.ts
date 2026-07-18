// @vitest-environment node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type MigrationResult = {
  applied: string[];
};

type MigrationRunner = {
  applyMigrations(options: {
    connectionString: string;
    migrationsDir: string;
    throughVersion?: string;
    bootstrapStorage?: boolean;
  }): Promise<MigrationResult>;
};

const connectionString = process.env.TEST_DATABASE_URL;
const localSupabase = process.env.TEST_SUPABASE_LOCAL === '1';
const migrationsDir = resolve(process.cwd(), 'supabase/migrations');
let client: import('pg').Client | undefined;
let serverSimulationClient: import('pg').Client | undefined;
let adminClient: import('pg').Client | undefined;
let rolelessConnectionString: string | undefined;
let grantConnectionString: string | undefined;
let backfillConnectionString: string | undefined;
let legacySessionId: string | undefined;
let rolelessMigration: MigrationResult | undefined;
let hardeningMigration: MigrationResult | undefined;
let publicRoleGrantsBeforeHardening: Array<Record<string, unknown>> | undefined;
const protectedTables = [
  'sessions',
  'events',
  'leads',
  'human_messages',
  'uploaded_files',
  'reference_links',
  'processed_telegram_updates',
  'handoff_outbox',
  'schema_migrations',
  'api_rate_limits',
  'session_consents',
  'crm_leads',
  'crm_lead_revisions',
  'monday_sync_outbox',
  'monday_reconciliation_checkpoints',
  'monday_reconciliation_seen'
] as const;
const publicRoles = ['anon', 'authenticated'] as const;

async function loadRunner(): Promise<MigrationRunner> {
  const runner = (await import(
    pathToFileURL(resolve(process.cwd(), 'scripts/apply-test-migrations.mjs')).href
  )) as MigrationRunner;
  return {
    applyMigrations(options) {
      return runner.applyMigrations({ ...options, bootstrapStorage: true });
    }
  };
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

async function deleteSessionForTest(client: import('pg').Client, sessionId: string) {
  await client.query('begin');
  try {
    // Keep append-only enforcement active in production; bypass it only for test teardown.
    await client.query('set local session_replication_role = replica');
    await client.query('delete from public.session_consents where session_id = $1', [sessionId]);
    await client.query('set local session_replication_role = origin');
    await client.query('delete from public.sessions where id = $1', [sessionId]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
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
    expect(roleCheck.rows.map((row) => row.rolname).sort()).toEqual(localSupabase
      ? ['anon', 'authenticated']
      : []);

    const suffix = `${process.pid}_${Date.now()}`;
    const rolelessDatabase = `balance_assist_roleless_${suffix}`;
    const grantDatabase = `balance_assist_grants_${suffix}`;
    const backfillDatabase = `balance_assist_backfill_${suffix}`;
    rolelessConnectionString = withDatabase(connectionString!, rolelessDatabase);
    grantConnectionString = withDatabase(connectionString!, grantDatabase);
    backfillConnectionString = withDatabase(connectionString!, backfillDatabase);

    await adminClient.query(`create database ${rolelessDatabase}`);
    rolelessMigration = await runner.applyMigrations({
      connectionString: rolelessConnectionString,
      migrationsDir
    });

    await adminClient.query(`create database ${backfillDatabase}`);
    await runner.applyMigrations({
      connectionString: backfillConnectionString,
      migrationsDir,
      throughVersion: '022'
    });
    const backfillClient = new Client({ connectionString: backfillConnectionString });
    await backfillClient.connect();
    try {
      const legacySession = await backfillClient.query(
        `insert into public.sessions (source_url, created_at, updated_at)
         values ('https://legacy.example.test', '2025-01-01T00:00:00Z', '2025-01-02T03:04:05Z')
         returning id`
      );
      legacySessionId = legacySession.rows[0].id;
    } finally {
      await backfillClient.end();
    }
    await runner.applyMigrations({ connectionString: backfillConnectionString, migrationsDir });

    // Plain PostgreSQL CI lacks Supabase roles. Create restricted API roles only after
    // the roleless migration proves 018's conditional grants are portable.
    if (!localSupabase) {
      await adminClient.query(`
        CREATE ROLE anon NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
        CREATE ROLE authenticated NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
        CREATE ROLE service_role NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
      `);
    }
    await adminClient.query("CREATE ROLE server_role_simulation LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS PASSWORD 'test-service-role-password'");
    await adminClient.query(`CREATE DATABASE ${grantDatabase}`);

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
        CREATE SCHEMA storage;
        CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false);
        CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text NOT NULL, name text NOT NULL);
        GRANT USAGE ON SCHEMA public TO anon, authenticated, server_role_simulation;
        GRANT ALL PRIVILEGES ON TABLE
          public.sessions,
          public.events,
          public.leads,
          public.human_messages,
          public.uploaded_files,
          public.reference_links,
          public.processed_telegram_updates,
          public.handoff_outbox,
          public.schema_migrations
        TO anon, authenticated, server_role_simulation;
        GRANT SELECT ON storage.objects TO PUBLIC;
        CREATE POLICY temporary_attachments_anon_read ON storage.objects FOR SELECT TO anon USING (bucket_id = 'temporary-attachments');
        CREATE POLICY temporary_attachments_authenticated_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'temporary-attachments');
        CREATE POLICY unrelated_public_read ON storage.objects FOR SELECT TO PUBLIC USING (bucket_id is not null);
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
    if (adminClient && rolelessConnectionString && grantConnectionString && backfillConnectionString) {
      const rolelessDatabase = new URL(rolelessConnectionString).pathname.slice(1);
      const grantDatabase = new URL(grantConnectionString).pathname.slice(1);
      const backfillDatabase = new URL(backfillConnectionString).pathname.slice(1);
      await adminClient.query(`drop database if exists ${rolelessDatabase}`);
      await adminClient.query(`drop database if exists ${grantDatabase}`);
      await adminClient.query(`drop database if exists ${backfillDatabase}`);
      await adminClient.query(localSupabase
        ? 'drop role if exists server_role_simulation'
        : 'drop role if exists server_role_simulation, service_role, anon, authenticated');
    }
    await adminClient?.end();
  });

  it('applies the full chain, including 021, before public roles exist', () => {
    expect(rolelessMigration?.applied).toContain('018_public_schema_rls.sql');
    expect(rolelessMigration?.applied).toContain('019_api_rate_limits.sql');
    expect(rolelessMigration?.applied).toContain('020_api_rate_limit_retention.sql');
    expect(rolelessMigration?.applied).toContain('021_session_consents.sql');
    expect(rolelessMigration?.applied).toContain('022_session_consents_append_only.sql');
    expect(rolelessMigration?.applied).toContain('023_temporary_session_retention.sql');
    expect(rolelessMigration?.applied).toContain('024_temporary_expiry_hardening.sql');
    expect(rolelessMigration?.applied).toContain('044_monday_crm_projection_tables.sql');
  });

  it('upgrades a database already through 024 with the replacement purge function and ownership migration', () => {
    expect(publicRoleGrantsBeforeHardening).toEqual([
      { role_name: 'anon', schema_usage: true, table_select: true },
      { role_name: 'authenticated', schema_usage: true, table_select: true }
    ]);
    expect(hardeningMigration?.applied).toEqual([
      '018_public_schema_rls.sql',
      '019_api_rate_limits.sql',
      '020_api_rate_limit_retention.sql',
      '021_session_consents.sql',
      '022_session_consents_append_only.sql',
      '023_temporary_session_retention.sql',
      '024_temporary_expiry_hardening.sql',
       '025_in_flight_handoff_retention.sql',
       '026_handoff_claim_ownership.sql',
       '027_handoff_send_reservations.sql',
       '028_handoff_reservation_consent_recheck.sql',
       '029_private_attachment_storage.sql',
       '030_private_attachment_retention.sql',
       '031_private_attachment_cleanup_hardening.sql',
        '032_legacy_cleanup_record_remediation.sql',
        '033_private_attachment_live_attestation.sql',
        '034_private_attachment_effective_attestation.sql',
         '035_schema_migrations_tracker_hardening.sql',
         '036_atomic_mutations.sql',
         '037_scheduler_health.sql',
         '038_durable_deletion_jobs.sql',
         '039_deletion_scheduler_health.sql',
         '040_deletion_recovery_lifecycle.sql',
         '041_deletion_backlog_count.sql',
          '042_deletion_recovery_ownership.sql',
            '043_deletion_state_batched_cleanup.sql',
             '044_monday_crm_projection_tables.sql',
              '045_orphaned_private_attachment_cleanup.sql',
              '046_claim_next_handoff_qualification.sql',
               '047_atomic_crm_approval.sql',
               '048_monday_sync_state_machine.sql',
                '049_monday_crm_lifecycle.sql',
                '052_monday_scheduler_health.sql',
                '053_monday_reconciliation.sql',
                 '054_human_contact_consent.sql',
                 '055_final_review_approval.sql'
    ]);
  });

  it('removes a prefixed cleanup record and its storage object after its session was deleted', async () => {
    const { Client } = await import('pg');
    const runner = await loadRunner();
    const database = `balance_assist_legacy_cleanup_${process.pid}_${Date.now()}`;
    const connection = withDatabase(connectionString!, database);
    await adminClient!.query(`create database ${database}`);
    try {
      await runner.applyMigrations({ connectionString: connection, migrationsDir, throughVersion: '017' });
      const cleanupClient = new Client({ connectionString: connection });
      await cleanupClient.connect();
      try {
        await cleanupClient.query(`
          create schema storage;
          create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
          create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null);
        `);
        await runner.applyMigrations({ connectionString: connection, migrationsDir, throughVersion: '031' });
        const session = await cleanupClient.query("insert into public.sessions (source_url) values ('https://deleted-cleanup.example.test') returning id");
        const objectKey = `${session.rows[0].id}/legacy-object`;
        await cleanupClient.query("insert into storage.objects (bucket_id, name) values ('temporary-attachments', $1)", [objectKey]);
        await cleanupClient.query(
          `insert into public.private_attachment_cleanup (object_key, bucket, checksum_sha256, retention_expires_at, status)
           values ($1, 'temporary-attachments', repeat('0', 64), now(), 'pending_cleanup')`,
          [objectKey]
        );
        await cleanupClient.query('delete from public.sessions where id = $1', [session.rows[0].id]);

        await runner.applyMigrations({ connectionString: connection, migrationsDir });
        const remaining = await cleanupClient.query(
          `select
             exists(select 1 from public.private_attachment_cleanup where object_key = $1) as cleanup,
             exists(select 1 from storage.objects where bucket_id = 'temporary-attachments' and name = $1) as object`,
          [objectKey]
        );

        expect(remaining.rows).toEqual([{ cleanup: false, object: false }]);
      } finally {
        await cleanupClient.end();
      }
    } finally {
      await adminClient!.query(`drop database if exists ${database}`);
    }
  });

  it('upgrades a tokenless 026-era claim to pending before a new owner can claim it', async () => {
    const { Client } = await import('pg');
    const runner = await loadRunner();
    const database = `balance_assist_claim_upgrade_${process.pid}_${Date.now()}`;
    const upgradeConnection = withDatabase(connectionString!, database);
    await adminClient!.query(`create database ${database}`);
    try {
      await runner.applyMigrations({ connectionString: upgradeConnection, migrationsDir, throughVersion: '026' });
      const upgradeClient = new Client({ connectionString: upgradeConnection });
      await upgradeClient.connect();
      try {
        const session = await upgradeClient.query(
          "insert into public.sessions (source_url, draft_expires_at) values ('https://claim-upgrade.example.test', now() + interval '1 hour') returning id"
        );
        await upgradeClient.query("select public.record_session_consent($1, 'producer_transfer', true, '1.0')", [session.rows[0].id]);
        const handoff = await upgradeClient.query(
          "insert into public.handoff_outbox (session_id, payload, state, claim_expires_at, claim_token, idempotency_key) values ($1, '{}'::jsonb, 'claiming', now() + interval '1 hour', null, 'legacy-tokenless-' || gen_random_uuid()) returning id",
          [session.rows[0].id]
        );

        await runner.applyMigrations({ connectionString: upgradeConnection, migrationsDir });
        const row = await upgradeClient.query('select state, claim_expires_at, claim_token from public.handoff_outbox where id = $1', [handoff.rows[0].id]);

        expect(row.rows).toEqual([{ state: 'pending', claim_expires_at: null, claim_token: null }]);
      } finally {
        await upgradeClient.end();
      }
    } finally {
      await adminClient!.query(`drop database if exists ${database}`);
    }
  });

  it('creates the required current tables', async () => {
    const result = await client!.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[])",
       [['sessions', 'events', 'leads', 'human_messages', 'uploaded_files', 'reference_links', 'processed_telegram_updates', 'handoff_outbox', 'schema_migrations', 'api_rate_limits', 'session_consents', 'crm_leads', 'crm_lead_revisions', 'monday_sync_outbox', 'monday_reconciliation_checkpoints', 'monday_reconciliation_seen']]
    );

    expect(result.rows.map((row) => row.table_name).sort()).toEqual([
       'api_rate_limits',
       'crm_lead_revisions',
       'crm_leads',
       'events',
      'handoff_outbox',
      'human_messages',
       'leads',
        'monday_reconciliation_checkpoints',
        'monday_reconciliation_seen',
        'monday_sync_outbox',
      'processed_telegram_updates',
      'reference_links',
      'schema_migrations',
       'session_consents',
       'sessions',
      'uploaded_files'
    ]);
  });

  it('enables RLS and denies direct table privileges to public API roles and control tables', async () => {
    const rls = await client!.query(
      `select relname, relrowsecurity
       from pg_class
       where oid = any($1::regclass[])
       order by relname`,
       [protectedTables.map((table) => `public.${table}`)]
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
        protectedTables,
        ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
      ]
    );

    expect(rls.rows).toEqual(
      protectedTables
        .slice()
        .sort()
        .map((relname) => ({ relname, relrowsecurity: true }))
    );
    expect(privileges.rows).toEqual([]);
  });

  it('creates no policies on protected tables', async () => {
    const policies = await client!.query(
      `select tablename, policyname
       from pg_policies
       where schemaname = 'public' and tablename = any($1::text[])
       order by tablename, policyname`,
      [protectedTables]
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
      "select table_name, column_name from information_schema.columns where table_schema = 'public' and (table_name, column_name) in (('sessions', 'capability_hash'), ('sessions', 'capability_expires_at'), ('sessions', 'consent_version'), ('sessions', 'consented_at'), ('sessions', 'draft'), ('sessions', 'draft_version'), ('leads', 'idempotency_key'), ('uploaded_files', 'original_name'), ('uploaded_files', 'mime_type'), ('uploaded_files', 'status'), ('uploaded_files', 'storage_path'), ('processed_telegram_updates', 'update_id'), ('processed_telegram_updates', 'received_at'), ('handoff_outbox', 'idempotency_key'), ('handoff_outbox', 'claim_expires_at'), ('handoff_outbox', 'claim_token'))"
    );

    expect(result.rows.map((row) => `${row.table_name}.${row.column_name}`).sort()).toEqual([
      'handoff_outbox.claim_expires_at',
      'handoff_outbox.claim_token',
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

  it('backfills legacy temporary-session fields and supplies 24-hour defaults', async () => {
    const { Client } = await import('pg');
    const backfillClient = new Client({ connectionString: backfillConnectionString });
    await backfillClient.connect();
    try {
      const legacy = await backfillClient.query(
        `select last_activity_at = '2025-01-02T03:04:05Z'::timestamptz as activity_backfilled,
                draft_expires_at = '2025-01-03T03:04:05Z'::timestamptz as expiry_backfilled
         from public.sessions where id = $1`,
        [legacySessionId]
      );
      const defaults = await client!.query(
        `insert into public.sessions (source_url) values ('https://defaults.example.test')
         returning last_activity_at is not null as activity_defaulted,
                   draft_expires_at - last_activity_at = interval '24 hours' as expiry_defaulted`
      );

      expect(legacy.rows).toEqual([{ activity_backfilled: true, expiry_backfilled: true }]);
      expect(defaults.rows).toEqual([{ activity_defaulted: true, expiry_defaulted: true }]);
    } finally {
      await backfillClient.end();
    }
  });

  it('purges expired pending and completed handoffs, but defers a valid in-flight claim', async () => {
    const expired = await client!.query(
      `insert into public.sessions (source_url, draft_expires_at)
       values ('https://expired.example.test', now()) returning id`
    );
    const active = await client!.query(
      `insert into public.sessions (source_url, draft_expires_at)
       values ('https://active.example.test', now() + interval '1 hour') returning id`
    );
    const expiredSessionId = expired.rows[0].id;
    const activeSessionId = active.rows[0].id;
    const pendingHandoff = await client!.query(
      `insert into public.handoff_outbox (session_id, payload, state, idempotency_key)
        values ($1, '{}'::jsonb, 'pending', 'expired-pending-handoff-' || gen_random_uuid()) returning id`,
      [expiredSessionId]
    );
    const completed = await client!.query(
      `insert into public.sessions (source_url, draft_expires_at) values ('https://completed.example.test', now()) returning id`
    );
    const completedHandoff = await client!.query(
      `insert into public.handoff_outbox (session_id, payload, state, idempotency_key)
        values ($1, '{}'::jsonb, 'sent', 'completed-handoff-' || gen_random_uuid()) returning id`,
      [completed.rows[0].id]
    );
    const inFlight = await client!.query(
      `insert into public.sessions (source_url, draft_expires_at) values ('https://in-flight.example.test', now()) returning id`
    );
    const inFlightHandoff = await client!.query(
      `insert into public.handoff_outbox (session_id, payload, state, claim_expires_at, idempotency_key)
        values ($1, '{}'::jsonb, 'claiming', now() + interval '1 hour', 'in-flight-handoff-' || gen_random_uuid()) returning id`,
      [inFlight.rows[0].id]
    );
    await client!.query("select public.record_session_consent($1, 'analysis', true, '1.0')", [expiredSessionId]);
    const purged = await client!.query('select public.purge_expired_temporary_sessions() as count');
    const remaining = await client!.query(
      `select
          exists(select 1 from public.sessions where id = $1) as expired_session,
          exists(select 1 from public.session_consents where session_id = $1) as expired_consent,
          exists(select 1 from public.handoff_outbox where id = $3) as expired_handoff,
          exists(select 1 from public.sessions where id = $2) as active_session,
          exists(select 1 from public.sessions where id = $4) as completed_session,
          exists(select 1 from public.handoff_outbox where id = $5) as completed_handoff,
          exists(select 1 from public.sessions where id = $6) as in_flight_session,
          exists(select 1 from public.handoff_outbox where id = $7) as in_flight_handoff`,
       [expiredSessionId, activeSessionId, pendingHandoff.rows[0].id, completed.rows[0].id, completedHandoff.rows[0].id, inFlight.rows[0].id, inFlightHandoff.rows[0].id]
    );

    expect(purged.rows).toEqual([{ count: { deleted_sessions: 2, deferred_sessions: 1, released_claims: 0 } }]);
    expect(remaining.rows).toEqual([{ expired_session: false, expired_consent: false, expired_handoff: false, active_session: true, completed_session: false, completed_handoff: false, in_flight_session: true, in_flight_handoff: true }]);

    await client!.query('delete from public.sessions where id = $1', [activeSessionId]);
    await client!.query('delete from public.sessions where id = $1', [inFlight.rows[0].id]);
  });

  it('purges an expired session once its handoff lease has expired', async () => {
    const session = await client!.query(
      `insert into public.sessions (source_url, draft_expires_at) values ('https://expired-lease.example.test', now()) returning id`
    );
    const handoff = await client!.query(
      `insert into public.handoff_outbox (session_id, payload, state, claim_expires_at, idempotency_key)
       values ($1, '{}'::jsonb, 'claiming', now() - interval '1 second', 'expired-lease-' || gen_random_uuid()) returning id`,
      [session.rows[0].id]
    );

    const purged = await client!.query('select public.purge_expired_temporary_sessions() as count');
    const remaining = await client!.query(
      'select exists(select 1 from public.sessions where id = $1) as session, exists(select 1 from public.handoff_outbox where id = $2) as handoff',
      [session.rows[0].id, handoff.rows[0].id]
    );

    expect(purged.rows[0].count.released_claims).toBeGreaterThanOrEqual(1);
    expect(remaining.rows).toEqual([{ session: false, handoff: false }]);
  });

  it('defers an expired session until private-object cleanup completes', async () => {
    const session = await client!.query(
      "insert into public.sessions (source_url, draft_expires_at) values ('https://deferred-private-object.example.test', now()) returning id"
    );
    const sessionId = session.rows[0].id;

    const purged = await client!.query('select public.purge_expired_temporary_sessions(array[$1]::uuid[]) as count', [sessionId]);
    const remaining = await client!.query('select exists(select 1 from public.sessions where id = $1) as session', [sessionId]);

    expect(purged.rows).toEqual([{ count: { deleted_sessions: 0, deferred_sessions: 1, released_claims: 0 } }]);
    expect(remaining.rows).toEqual([{ session: true }]);
    await deleteSessionForTest(client!, sessionId);
  });

  it('provisions a private bucket and removes every browser-role object policy and grant', async () => {
    const bucket = await client!.query("select id, public from storage.buckets where id = 'temporary-attachments'");
    const policies = await client!.query(`
      select policyname
      from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and (roles && array['anon'::name, 'authenticated'::name] or roles && array['public'::name])
        and roles && array['public'::name, 'anon'::name, 'authenticated'::name]
    `);
    const readiness = await client!.query("select status from public.private_attachment_storage_readiness where bucket = 'temporary-attachments'");
    const privileges = await client!.query(`
      select
        has_table_privilege('anon', 'storage.objects', 'SELECT') as anon_read,
        has_table_privilege('authenticated', 'storage.objects', 'SELECT') as authenticated_read
    `);

    expect(bucket.rows).toEqual([{ id: 'temporary-attachments', public: false }]);
    expect(policies.rows).toEqual([]);
    expect(readiness.rows).toEqual([{ status: 'ready' }]);
    expect(privileges.rows).toEqual([{ anon_read: false, authenticated_read: false }]);
  });

  it('suppresses an unclaimed handoff when producer-transfer consent was revoked', async () => {
    const session = await client!.query(
      `insert into public.sessions (source_url, draft_expires_at)
       values ('https://revoked-handoff.example.test', now() + interval '1 hour') returning id`
    );
    const sessionId = session.rows[0].id;
    const handoff = await client!.query(
      `insert into public.handoff_outbox (session_id, payload, state, idempotency_key)
       values ($1, '{}'::jsonb, 'pending', 'revoked-handoff-' || gen_random_uuid()) returning id`,
      [sessionId]
    );
    await client!.query("select public.record_session_consent($1, 'producer_transfer', true, '1.2')", [sessionId]);
    await client!.query("select public.record_session_consent($1, 'producer_transfer', false, '1.0')", [sessionId]);

    const claim = await client!.query('select * from public.claim_next_handoff()');
    const state = await client!.query('select state, claim_expires_at from public.handoff_outbox where id = $1', [handoff.rows[0].id]);

    expect(claim.rows).toEqual([expect.objectContaining({ id: handoff.rows[0].id, resolution: 'suppressed' })]);
    expect(state.rows).toEqual([{ state: 'failed', claim_expires_at: null }]);
    await deleteSessionForTest(client!, sessionId);
  });

  it('suppresses an unclaimed handoff when its session is already expired', async () => {
    const session = await client!.query(
      `insert into public.sessions (source_url, draft_expires_at)
       values ('https://expired-pending-handoff.example.test', now()) returning id`
    );
    const sessionId = session.rows[0].id;
    const handoff = await client!.query(
      `insert into public.handoff_outbox (session_id, payload, state, idempotency_key)
       values ($1, '{}'::jsonb, 'pending', 'expired-pending-' || gen_random_uuid()) returning id`,
      [sessionId]
    );
    await client!.query("select public.record_session_consent($1, 'producer_transfer', true, '1.2')", [sessionId]);

    const claim = await client!.query('select * from public.claim_next_handoff()');
    const state = await client!.query('select state, claim_expires_at from public.handoff_outbox where id = $1', [handoff.rows[0].id]);

    expect(claim.rows).toEqual([expect.objectContaining({ id: handoff.rows[0].id, resolution: 'suppressed' })]);
    expect(state.rows).toEqual([{ state: 'failed', claim_expires_at: null }]);
    await deleteSessionForTest(client!, sessionId);
  });

  it('rejects stale ownership-token completion after a lease is reclaimed', async () => {
    const session = await client!.query(
      `insert into public.sessions (source_url, draft_expires_at)
       values ('https://claim-ownership.example.test', now() + interval '1 hour') returning id`
    );
    const sessionId = session.rows[0].id;
    await client!.query("select public.record_session_consent($1, 'producer_transfer', true, '1.0')", [sessionId]);
    const handoff = await client!.query(
      `insert into public.handoff_outbox (session_id, payload, state, idempotency_key)
       values ($1, '{}'::jsonb, 'pending', 'claim-ownership-' || gen_random_uuid()) returning id`,
      [sessionId]
    );

    const first = await client!.query('select * from public.claim_next_handoff()');
    await client!.query('update public.handoff_outbox set claim_expires_at = now() - interval \'1 second\' where id = $1', [handoff.rows[0].id]);
    const second = await client!.query('select * from public.claim_next_handoff()');
    const stale = await client!.query(
      "update public.handoff_outbox set state = 'sent' where id = $1 and state = 'claiming' and claim_token = $2 returning id",
      [handoff.rows[0].id, first.rows[0].claim_token]
    );
    const current = await client!.query(
      "update public.handoff_outbox set state = 'sent' where id = $1 and state = 'claiming' and claim_token = $2 returning id",
      [handoff.rows[0].id, second.rows[0].claim_token]
    );

    expect(first.rows[0].claim_token).not.toBe(second.rows[0].claim_token);
    expect(stale.rows).toEqual([]);
    expect(current.rows).toEqual([{ id: handoff.rows[0].id }]);
    await deleteSessionForTest(client!, sessionId);
  });

  it('does not reclaim a reserved send before its bounded Telegram-call lease expires', async () => {
    const session = await client!.query(
      "insert into public.sessions (source_url, draft_expires_at) values ('https://send-reservation.example.test', now() + interval '1 hour') returning id"
    );
    const sessionId = session.rows[0].id;
    await client!.query("select public.record_session_consent($1, 'producer_transfer', true, '1.2')", [sessionId]);
    const handoff = await client!.query(
      "insert into public.handoff_outbox (session_id, payload, state, idempotency_key) values ($1, '{}'::jsonb, 'pending', 'send-reservation-' || gen_random_uuid()) returning id",
      [sessionId]
    );

    const first = await client!.query('select * from public.claim_next_handoff()');
    const reserved = await client!.query('select public.reserve_handoff_send($1, $2) as reserved', [handoff.rows[0].id, first.rows[0].claim_token]);
    const concurrent = await client!.query('select * from public.claim_next_handoff()');
    await client!.query("update public.handoff_outbox set claim_expires_at = now() - interval '1 second' where id = $1", [handoff.rows[0].id]);
    const reclaimed = await client!.query('select * from public.claim_next_handoff()');
    const staleCompletion = await client!.query(
      "update public.handoff_outbox set state = 'sent' where id = $1 and state = 'sending' and claim_token = $2 returning id",
      [handoff.rows[0].id, first.rows[0].claim_token]
    );

    expect(reserved.rows).toEqual([{ reserved: true }]);
    expect(concurrent.rows).toEqual([]);
    expect(reclaimed.rows[0].claim_token).not.toBe(first.rows[0].claim_token);
    expect(staleCompletion.rows).toEqual([]);
    await deleteSessionForTest(client!, sessionId);
  });

  it('grants the expiry RPC only to service_role', async () => {
    const privileges = await client!.query(
      `select
          has_function_privilege('service_role', 'public.purge_expired_temporary_sessions(uuid[])', 'EXECUTE') as service_purge,
          has_function_privilege('anon', 'public.purge_expired_temporary_sessions(uuid[])', 'EXECUTE') as anon_purge,
          has_function_privilege('authenticated', 'public.purge_expired_temporary_sessions(uuid[])', 'EXECUTE') as authenticated_purge`
    );

    expect(privileges.rows).toEqual([{
      service_purge: true,
      anon_purge: false,
      authenticated_purge: false
    }]);
  });

  it('binds each outbox row to an approved revision and keeps its intent and ledger immutable', async () => {
    const crmLead = await client!.query(
      `insert into public.crm_leads (review_due_at)
       values (now() + interval '1 day') returning id`
    );
    const crmLeadId = crmLead.rows[0].id;
    const revisionPayload = { contactEmail: 'immutable@example.test' };

    try {
      await client!.query(
        `insert into public.crm_lead_revisions (
           crm_lead_id, revision, source_draft_version, approval_input_hash, payload,
           payload_hash, approved_at, consent_notice_version, consent_recorded_at
         ) values ($1, 1, 0, repeat('a', 64), $2::jsonb, repeat('b', 64), now(), 'monday-v1', now())`,
        [crmLeadId, JSON.stringify(revisionPayload)]
      );
      const outbox = await client!.query(
        `insert into public.monday_sync_outbox (crm_lead_id, revision, operation)
         values ($1, 1, 'upsert') returning id`,
        [crmLeadId]
      );
      await expect(
        client!.query(
          "insert into public.monday_sync_outbox (crm_lead_id, revision, operation) values ($1, 2, 'delete')",
          [crmLeadId]
        )
      ).rejects.toThrow();
      await expect(
        client!.query(
          "insert into public.monday_sync_outbox (crm_lead_id, revision, operation) values ($1, 0, 'delete')",
          [crmLeadId]
        )
      ).rejects.toThrow();
      await expect(
        client!.query(
          `update public.monday_sync_outbox
           set provider_operation = 'create', frozen_payload_hash = repeat('c', 64),
               item_name = 'Balance Assist - 1234', request_key = gen_random_uuid()
           where id = $1`,
          [outbox.rows[0].id]
        )
      ).rejects.toThrow('frozen payload hash must match the approved revision');
      await client!.query(
        `update public.monday_sync_outbox
         set provider_operation = 'create', frozen_payload_hash = repeat('b', 64),
             item_name = 'Balance Assist - 1234', request_key = gen_random_uuid()
         where id = $1`,
        [outbox.rows[0].id]
      );
      await expect(
        client!.query(
          `insert into public.monday_sync_outbox (crm_lead_id, revision, operation, frozen_payload_hash)
           values ($1, 1, 'delete', repeat('c', 64))`,
          [crmLeadId]
        )
      ).rejects.toThrow('frozen payload hash must match the approved revision');
      await client!.query(
        "insert into public.monday_sync_outbox (crm_lead_id, revision, operation) values ($1, 1, 'delete')",
        [crmLeadId]
      );

      await expect(
        client!.query('update public.monday_sync_outbox set request_key = gen_random_uuid() where id = $1', [outbox.rows[0].id])
      ).rejects.toThrow('request key cannot change');
      await expect(
        client!.query(
          "update public.crm_lead_revisions set payload = '{\"contactEmail\":\"changed@example.test\"}'::jsonb where crm_lead_id = $1 and revision = 1",
          [crmLeadId]
        )
      ).rejects.toThrow('approved revision ledger is immutable');
      await expect(
        client!.query(
          "update public.crm_lead_revisions set payload_hash = repeat('d', 64) where crm_lead_id = $1 and revision = 1",
          [crmLeadId]
        )
      ).rejects.toThrow('approved revision ledger is immutable');
      await expect(
        client!.query(
          "update public.crm_lead_revisions set consent_notice_version = 'changed' where crm_lead_id = $1 and revision = 1",
          [crmLeadId]
        )
      ).rejects.toThrow('approved revision ledger is immutable');
      await expect(
        client!.query(
          "update public.crm_lead_revisions set approved_at = now() + interval '1 day' where crm_lead_id = $1 and revision = 1",
          [crmLeadId]
        )
      ).rejects.toThrow('approved revision ledger is immutable');
    } finally {
      await client!.query('delete from public.monday_sync_outbox where crm_lead_id = $1', [crmLeadId]);
      await client!.query('delete from public.crm_leads where id = $1', [crmLeadId]);
    }
  });

  it('uses service-role-only token-guarded Monday sync transitions and a scrub-before-delete barrier', async () => {
    const crmLead = await client!.query(
      `insert into public.crm_leads (desired_revision, review_due_at, lifecycle_state)
       values (1, now() + interval '1 day', 'active') returning id`
    );
    const crmLeadId = crmLead.rows[0].id;

    try {
      await client!.query(
        `insert into public.crm_lead_revisions (
           crm_lead_id, revision, source_draft_version, approval_input_hash, payload,
           payload_hash, approved_at, consent_notice_version, consent_recorded_at
         ) values ($1, 1, 0, repeat('1', 64), '{"crmRecordId":"opaque"}'::jsonb, repeat('2', 64), now(), '1.2', now())`,
        [crmLeadId]
      );
      const outbox = await client!.query(
        "insert into public.monday_sync_outbox (crm_lead_id, revision, operation) values ($1, 1, 'upsert') returning id",
        [crmLeadId]
      );
      const claim = await client!.query('select * from public.claim_next_monday_sync()', []);
      const token = claim.rows[0].claim_token;
      const reserved = await client!.query('select * from public.reserve_monday_sync_send($1, $2)', [outbox.rows[0].id, token]);
      const stale = await client!.query("select public.complete_monday_sync_upsert($1, gen_random_uuid(), 'monday-item') as applied", [outbox.rows[0].id]);
      await client!.query("update public.crm_leads set lifecycle_state = 'deletion_requested' where id = $1", [crmLeadId]);
      const completed = await client!.query("select public.complete_monday_sync_upsert($1, $2, 'monday-item') as applied", [outbox.rows[0].id, token]);
      const deletion = await client!.query("select id from public.monday_sync_outbox where crm_lead_id = $1 and revision = 1 and operation = 'delete'", [crmLeadId]);
      const deletionClaim = await client!.query('select * from public.claim_next_monday_sync()');
      const deletionToken = deletionClaim.rows[0].claim_token;
      const deletionReserved = await client!.query('select * from public.reserve_monday_sync_send($1, $2)', [deletion.rows[0].id, deletionToken]);
      const scrubbed = await client!.query('select public.complete_monday_sync_scrub($1, $2) as applied', [deletion.rows[0].id, deletionToken]);
      const deleteReserved = await client!.query('select * from public.reserve_monday_sync_send($1, $2)', [deletion.rows[0].id, deletionToken]);
      const deleted = await client!.query("select public.complete_monday_sync_delete($1, $2, 'delete-receipt') as applied", [deletion.rows[0].id, deletionToken]);
      const tombstone = await client!.query('select lifecycle_state, monday_item_id from public.crm_leads where id = $1', [crmLeadId]);
      const privileges = await client!.query(`select
        has_function_privilege('service_role', 'public.claim_next_monday_sync(integer)', 'EXECUTE') as service_claim,
        has_function_privilege('anon', 'public.claim_next_monday_sync(integer)', 'EXECUTE') as anon_claim,
        has_function_privilege('authenticated', 'public.complete_monday_sync_delete(uuid, uuid, text)', 'EXECUTE') as authenticated_delete`);

      expect(claim.rows[0]).toMatchObject({ id: outbox.rows[0].id, resolution: 'claimed' });
      expect(reserved.rows).toEqual([expect.objectContaining({ provider_operation: 'create', target_item_id: null, frozen_payload_hash: '2'.repeat(64), request_key: expect.any(String) })]);
      expect(stale.rows).toEqual([{ applied: false }]);
      expect(completed.rows).toEqual([{ applied: true }]);
      expect(deletionClaim.rows[0]).toMatchObject({ id: deletion.rows[0].id, operation: 'delete' });
      expect(deletionReserved.rows).toEqual([expect.objectContaining({ provider_operation: 'scrub', request_key: expect.any(String) })]);
      expect(scrubbed.rows).toEqual([{ applied: true }]);
      expect(deleteReserved.rows).toEqual([expect.objectContaining({ provider_operation: 'delete', request_key: expect.any(String) })]);
      expect(deleted.rows).toEqual([{ applied: true }]);
      expect(tombstone.rows).toEqual([{ lifecycle_state: 'deleted', monday_item_id: null }]);
      expect(privileges.rows).toEqual([{ service_claim: true, anon_claim: false, authenticated_delete: false }]);
    } finally {
      await client!.query('delete from public.monday_sync_outbox where crm_lead_id = $1', [crmLeadId]);
      await client!.query('delete from public.crm_leads where id = $1', [crmLeadId]);
    }
  });

  it('reserves against the exact consent recorded by the approved revision and never retries a sent create as pending', async () => {
    const session = await client!.query("insert into public.sessions (source_url) values ('https://revision-consent.example.test') returning id");
    const sessionId = session.rows[0].id;
    const crmLead = await client!.query(
      `insert into public.crm_leads (source_session_id, desired_revision, review_due_at)
       values ($1, 1, now() + interval '1 day') returning id`,
      [sessionId]
    );
    const crmLeadId = crmLead.rows[0].id;

    try {
      await client!.query("select public.record_session_consent($1, 'producer_transfer', true, 'approved-monday-v9')", [sessionId]);
      await client!.query(
        `insert into public.crm_lead_revisions (
           crm_lead_id, revision, source_draft_version, approval_input_hash, payload,
           payload_hash, approved_at, consent_notice_version, consent_recorded_at
         ) values ($1, 1, 0, repeat('3', 64), '{}'::jsonb, repeat('4', 64), now(), 'approved-monday-v9', now())`,
        [crmLeadId]
      );
      const outbox = await client!.query(
        "insert into public.monday_sync_outbox (crm_lead_id, revision, operation) values ($1, 1, 'upsert') returning id",
        [crmLeadId]
      );
      const claim = await client!.query('select * from public.claim_next_monday_sync()');
      const token = claim.rows[0].claim_token;
      const reserved = await client!.query('select * from public.reserve_monday_sync_send($1, $2)', [outbox.rows[0].id, token]);
      const retried = await client!.query("select public.mark_monday_sync_retry($1, $2, 'monday_temporary_failure', 1) as applied", [outbox.rows[0].id, token]);
      const state = await client!.query('select state, claim_token from public.monday_sync_outbox where id = $1', [outbox.rows[0].id]);

      expect(reserved.rows).toEqual([expect.objectContaining({ provider_operation: 'create', frozen_payload_hash: '4'.repeat(64), request_key: expect.any(String) })]);
      expect(retried.rows).toEqual([{ applied: true }]);
      expect(state.rows).toEqual([{ state: 'delivery_unknown', claim_token: null }]);
    } finally {
      await client!.query('delete from public.monday_sync_outbox where crm_lead_id = $1', [crmLeadId]);
      await client!.query('delete from public.crm_leads where id = $1', [crmLeadId]);
      await deleteSessionForTest(client!, sessionId);
    }
  });

  it('adopts a verified unknown create without rewriting its immutable provider intent', async () => {
    const crmLead = await client!.query(
      "insert into public.crm_leads (desired_revision, review_due_at) values (1, now() + interval '1 day') returning id"
    );
    const crmLeadId = crmLead.rows[0].id;
    try {
      await client!.query(
        `insert into public.crm_lead_revisions (crm_lead_id, revision, source_draft_version, approval_input_hash, payload, payload_hash, approved_at, consent_notice_version, consent_recorded_at)
         values ($1, 1, 0, repeat('5', 64), '{}'::jsonb, repeat('6', 64), now(), '1.2', now())`,
        [crmLeadId]
      );
      await client!.query(
        "insert into public.monday_sync_outbox (crm_lead_id, revision, operation, state, provider_operation) values ($1, 1, 'upsert', 'delivery_unknown', 'create')",
        [crmLeadId]
      );
      const checkpoint = await client!.query('select * from public.claim_monday_reconciliation_page()');
      const reconciled = await client!.query(
        'select public.record_monday_reconciled_item($1, $2, $3, true, false) as result',
        [checkpoint.rows[0].id, 'verified-item', crmLeadId]
      );
      const state = await client!.query('select state, target_item_id from public.monday_sync_outbox where crm_lead_id = $1', [crmLeadId]);
      const receipt = await client!.query('select monday_item_id from public.crm_leads where id = $1', [crmLeadId]);

      expect(reconciled.rows).toEqual([{ result: 'adopted' }]);
      expect(state.rows).toEqual([{ state: 'synced', target_item_id: null }]);
      expect(receipt.rows).toEqual([{ monday_item_id: 'verified-item' }]);
    } finally {
      await client!.query('delete from public.monday_reconciliation_checkpoints');
      await client!.query('delete from public.monday_sync_outbox where crm_lead_id = $1', [crmLeadId]);
      await client!.query('delete from public.crm_leads where id = $1', [crmLeadId]);
    }
  });

  it('suppresses obsolete revisions and turns an expired create reservation into delivery unknown', async () => {
    const crmLead = await client!.query(
      `insert into public.crm_leads (desired_revision, review_due_at)
       values (2, now() + interval '1 day') returning id`
    );
    const crmLeadId = crmLead.rows[0].id;
    try {
      for (const revision of [1, 2]) {
        await client!.query(
          `insert into public.crm_lead_revisions (
             crm_lead_id, revision, source_draft_version, approval_input_hash, payload,
             payload_hash, approved_at, consent_notice_version, consent_recorded_at
           ) values ($1, $2, 0, repeat($3, 64), '{}'::jsonb, repeat('5', 64), now(), '1.2', now())`,
          [crmLeadId, revision, String(revision)]
        );
        await client!.query("insert into public.monday_sync_outbox (crm_lead_id, revision, operation) values ($1, $2, 'upsert')", [crmLeadId, revision]);
      }
      const suppressed = await client!.query('select * from public.claim_next_monday_sync()');
      const current = await client!.query('select * from public.claim_next_monday_sync()');
      const token = current.rows[0].claim_token;
      const reserved = await client!.query('select * from public.reserve_monday_sync_send($1, $2)', [current.rows[0].id, token]);
      await client!.query("update public.monday_sync_outbox set claim_expires_at = now() - interval '1 second' where id = $1", [current.rows[0].id]);
      const afterCrash = await client!.query('select * from public.claim_next_monday_sync()');
      const state = await client!.query('select state, claim_token from public.monday_sync_outbox where id = $1', [current.rows[0].id]);

      expect(suppressed.rows).toEqual([expect.objectContaining({ revision: 1, resolution: 'suppressed', claim_token: null })]);
      expect(current.rows).toEqual([expect.objectContaining({ revision: 2, resolution: 'claimed', claim_token: expect.any(String) })]);
      expect(reserved.rows).toEqual([expect.objectContaining({ provider_operation: 'create', request_key: expect.any(String) })]);
      expect(afterCrash.rows).toEqual([expect.objectContaining({ id: current.rows[0].id, resolution: 'recovery', claim_token: expect.any(String) })]);
      expect(state.rows).toEqual([{ state: 'claiming', claim_token: afterCrash.rows[0].claim_token }]);
    } finally {
      await client!.query('delete from public.monday_sync_outbox where crm_lead_id = $1', [crmLeadId]);
      await client!.query('delete from public.crm_leads where id = $1', [crmLeadId]);
    }
  });

  it('serializes concurrent claims and suppresses a claim revoked before send reservation', async () => {
    const session = await client!.query("insert into public.sessions (source_url) values ('https://claim-revocation.example.test') returning id");
    const sessionId = session.rows[0].id;
    const crmLead = await client!.query(
      `insert into public.crm_leads (source_session_id, desired_revision, review_due_at)
       values ($1, 1, now() + interval '1 day') returning id`,
      [sessionId]
    );
    const crmLeadId = crmLead.rows[0].id;
    const { Client } = await import('pg');
    const competingClient = new Client({ connectionString: grantConnectionString });
    await competingClient.connect();
    try {
      await client!.query("select public.record_session_consent($1, 'producer_transfer', true, '1.2')", [sessionId]);
      await client!.query(
        `insert into public.crm_lead_revisions (
           crm_lead_id, revision, source_draft_version, approval_input_hash, payload,
           payload_hash, approved_at, consent_notice_version, consent_recorded_at
         ) values ($1, 1, 0, repeat('6', 64), '{}'::jsonb, repeat('7', 64), now(), '1.2', now())`,
        [crmLeadId]
      );
      const outbox = await client!.query("insert into public.monday_sync_outbox (crm_lead_id, revision, operation) values ($1, 1, 'upsert') returning id", [crmLeadId]);
      const [first, second] = await Promise.all([
        client!.query('select * from public.claim_next_monday_sync()'),
        competingClient.query('select * from public.claim_next_monday_sync()'),
      ]);
      const claimed = [first, second].find((result) => result.rows.length === 1)!;
      const empty = [first, second].find((result) => result.rows.length === 0)!;
      await client!.query("select public.record_session_consent($1, 'producer_transfer', false, '1.2')", [sessionId]);
      const reserved = await client!.query('select * from public.reserve_monday_sync_send($1, $2)', [outbox.rows[0].id, claimed.rows[0].claim_token]);
      const state = await client!.query('select state, claim_token from public.monday_sync_outbox where id = $1', [outbox.rows[0].id]);

      expect(claimed.rows[0]).toMatchObject({ id: outbox.rows[0].id, resolution: 'claimed' });
      expect(empty.rows).toEqual([]);
      expect(reserved.rows).toEqual([]);
      expect(state.rows).toEqual([{ state: 'suppressed', claim_token: null }]);
    } finally {
      await competingClient.end();
      await client!.query('delete from public.monday_sync_outbox where crm_lead_id = $1', [crmLeadId]);
      await client!.query('delete from public.crm_leads where id = $1', [crmLeadId]);
      await deleteSessionForTest(client!, sessionId);
    }
  });

  it('converges deletion without an item only when no create was ever sent', async () => {
    const crmLead = await client!.query("insert into public.crm_leads (desired_revision, review_due_at, lifecycle_state) values (1, now() + interval '1 day', 'deletion_requested') returning id");
    const crmLeadId = crmLead.rows[0].id;
    try {
      await client!.query(`insert into public.crm_lead_revisions (crm_lead_id, revision, source_draft_version, approval_input_hash, payload, payload_hash, approved_at, consent_notice_version, consent_recorded_at) values ($1, 1, 0, repeat('8', 64), '{}'::jsonb, repeat('9', 64), now(), '1.2', now())`, [crmLeadId]);
      const deletion = await client!.query("insert into public.monday_sync_outbox (crm_lead_id, revision, operation) values ($1, 1, 'delete') returning id", [crmLeadId]);
      const claim = await client!.query('select * from public.claim_next_monday_sync()');
      const reserved = await client!.query('select * from public.reserve_monday_sync_send($1, $2)', [deletion.rows[0].id, claim.rows[0].claim_token]);
      const tombstone = await client!.query('select lifecycle_state, monday_item_id from public.crm_leads where id = $1', [crmLeadId]);

      expect(reserved.rows).toEqual([]);
      expect(tombstone.rows).toEqual([{ lifecycle_state: 'deleted', monday_item_id: null }]);
    } finally {
      await client!.query('delete from public.monday_sync_outbox where crm_lead_id = $1', [crmLeadId]);
      await client!.query('delete from public.crm_leads where id = $1', [crmLeadId]);
    }
  });

  it('queues deletion when consent is revoked after an upsert was reserved but before its receipt', async () => {
    const session = await client!.query("insert into public.sessions (source_url) values ('https://sending-revocation.example.test') returning id");
    const sessionId = session.rows[0].id;
    const crmLead = await client!.query("insert into public.crm_leads (source_session_id, desired_revision, review_due_at) values ($1, 1, now() + interval '1 day') returning id", [sessionId]);
    const crmLeadId = crmLead.rows[0].id;
    try {
      await client!.query("select public.record_session_consent($1, 'producer_transfer', true, '1.2')", [sessionId]);
      await client!.query(`insert into public.crm_lead_revisions (crm_lead_id, revision, source_draft_version, approval_input_hash, payload, payload_hash, approved_at, consent_notice_version, consent_recorded_at) values ($1, 1, 0, repeat('a', 64), '{}'::jsonb, repeat('b', 64), now(), '1.2', now())`, [crmLeadId]);
      const outbox = await client!.query("insert into public.monday_sync_outbox (crm_lead_id, revision, operation) values ($1, 1, 'upsert') returning id", [crmLeadId]);
      const claim = await client!.query('select * from public.claim_next_monday_sync()');
      await client!.query('select * from public.reserve_monday_sync_send($1, $2)', [outbox.rows[0].id, claim.rows[0].claim_token]);
      await client!.query("select public.record_session_consent($1, 'producer_transfer', false, '1.2')", [sessionId]);
      const completed = await client!.query("select public.complete_monday_sync_upsert($1, $2, 'late-item') as applied", [outbox.rows[0].id, claim.rows[0].claim_token]);
      const lead = await client!.query('select lifecycle_state, monday_item_id from public.crm_leads where id = $1', [crmLeadId]);
      const deletion = await client!.query("select operation, state from public.monday_sync_outbox where crm_lead_id = $1 and operation = 'delete'", [crmLeadId]);

      expect(completed.rows).toEqual([{ applied: true }]);
      expect(lead.rows).toEqual([{ lifecycle_state: 'deletion_requested', monday_item_id: 'late-item' }]);
      expect(deletion.rows).toEqual([{ operation: 'delete', state: 'pending' }]);
    } finally {
      await client!.query('delete from public.monday_sync_outbox where crm_lead_id = $1', [crmLeadId]);
      await client!.query('delete from public.crm_leads where id = $1', [crmLeadId]);
      await deleteSessionForTest(client!, sessionId);
    }
  });

  it('enforces CRM retention, review grace, session expiry, opaque DSRs, and deletion barriers', async () => {
    const session = await client!.query("insert into public.sessions (source_url, draft_expires_at) values ('https://lifecycle.example.test', now() - interval '1 minute') returning id");
    const sessionId = session.rows[0].id;
    const barrierSession = await client!.query("insert into public.sessions (source_url) values ('https://deletion-barrier.example.test') returning id");
    const barrierSessionId = barrierSession.rows[0].id;
    const leadRows = await client!.query(
      `insert into public.crm_leads (source_session_id, desired_revision, review_due_at, retention_expires_at, lifecycle_state) values
       (null, 1, now() + interval '90 days', now() - interval '1 minute', 'active'),
       (null, 1, now() - interval '1 minute', null, 'active'),
       (null, 1, now() - interval '31 days', null, 'review_overdue'),
       ($1, 1, now() + interval '90 days', null, 'active'),
       ($2, 1, now() + interval '90 days', null, 'active')
       returning id`,
      [sessionId, barrierSessionId]
    );
    const [terminal, dueReview, graceExpired, dsrLead, barrierLead] = leadRows.rows.map((row) => row.id);

    try {
      for (const [index, [id, status]] of [[terminal, 'unqualified'], [dueReview, 'qualified'], [graceExpired, 'qualified'], [dsrLead, 'qualified'], [barrierLead, 'qualified']].entries()) {
        await client!.query(
          `insert into public.crm_lead_revisions (
             crm_lead_id, revision, source_draft_version, approval_input_hash, payload,
             payload_hash, approved_at, consent_notice_version, consent_recorded_at
           ) values ($1, 1, 0, repeat($2, 64), jsonb_build_object('qualificationStatus', $3::text, 'contactEmail', 'remove@example.test'), repeat($4, 64), now(), '1.2', now())`,
          [id, String(index + 1), status, String(index + 5)]
        );
        await client!.query("insert into public.monday_sync_outbox (crm_lead_id, revision, operation) values ($1, 1, 'upsert')", [id]);
      }

      const queued = await client!.query('select public.queue_expired_crm_leads(100) as count');
      const states = await client!.query('select id, lifecycle_state from public.crm_leads where id = any($1::uuid[]) order by id', [[terminal, dueReview, graceExpired]]);
      const renewed = await client!.query("select public.renew_crm_lead_review($1, 'CASE-RENEW-001') as renewed", [dueReview]);
      const afterRenewal = await client!.query('select lifecycle_state, review_due_at > now() + interval \'89 days\' as due_after_renewal from public.crm_leads where id = $1', [dueReview]);
      const purged = await client!.query('select public.purge_expired_temporary_sessions() as count');
      const detached = await client!.query('select source_session_id from public.crm_leads where id = $1', [dsrLead]);
      const dsr = await client!.query("select public.request_crm_deletion_by_record_id($1, 'CASE-DSR-001') as queued", [dsrLead]);
      const job = await client!.query('select * from public.request_deletion_job($1)', [barrierSessionId]);
      const claim = await client!.query('select * from public.claim_deletion_job()');
      const started = await client!.query('select public.start_deletion_job($1, $2) as started', [claim.rows[0].id, claim.rows[0].lease_token]);
      const blocked = await client!.query('select public.delete_session_for_deletion_job($1, $2) as deleted', [claim.rows[0].id, claim.rows[0].lease_token]);

      expect(queued.rows).toEqual([{ count: 3 }]);
      expect(states.rows).toEqual(expect.arrayContaining([
        { id: terminal, lifecycle_state: 'deletion_requested' },
        { id: dueReview, lifecycle_state: 'review_overdue' },
        { id: graceExpired, lifecycle_state: 'deletion_requested' },
      ]));
      expect(renewed.rows).toEqual([{ renewed: true }]);
      expect(afterRenewal.rows).toEqual([{ lifecycle_state: 'active', due_after_renewal: true }]);
      expect(purged.rows[0].count).toEqual(expect.objectContaining({ deleted_sessions: expect.any(Number) }));
      expect(detached.rows).toEqual([{ source_session_id: null }]);
      expect(dsr.rows).toEqual([{ queued: true }]);
      expect(job.rows).toHaveLength(1);
      expect(started.rows).toEqual([{ started: true }]);
      expect(blocked.rows).toEqual([{ deleted: false }]);
    } finally {
      await client!.query('delete from public.monday_sync_outbox where crm_lead_id = any($1::uuid[])', [[terminal, dueReview, graceExpired, dsrLead, barrierLead]]);
      await client!.query('delete from public.crm_leads where id = any($1::uuid[])', [[terminal, dueReview, graceExpired, dsrLead, barrierLead]]);
      await client!.query('delete from public.deletion_jobs where session_id = $1', [barrierSessionId]);
      await deleteSessionForTest(client!, sessionId);
      await deleteSessionForTest(client!, barrierSessionId);
    }
  });

  it('removes a superseded revision payload only after its provider work cannot be retried', async () => {
    const crmLead = await client!.query("insert into public.crm_leads (desired_revision, review_due_at) values (1, now() + interval '1 day') returning id");
    const crmLeadId = crmLead.rows[0].id;
    try {
      for (const revision of [1, 2]) {
        await client!.query(
          `insert into public.crm_lead_revisions (crm_lead_id, revision, source_draft_version, approval_input_hash, payload, payload_hash, approved_at, consent_notice_version, consent_recorded_at)
           values ($1, $2, 0, repeat($3, 64), jsonb_build_object('contactEmail', 'remove@example.test'), repeat($4, 64), now(), '1.2', now())`,
          [crmLeadId, revision, String(revision), String(revision + 2)]
        );
        await client!.query("insert into public.monday_sync_outbox (crm_lead_id, revision, operation, state) values ($1, $2, 'upsert', $3)", [crmLeadId, revision, revision === 1 ? 'synced' : 'pending']);
      }

      await client!.query('update public.crm_leads set desired_revision = 2 where id = $1', [crmLeadId]);

      const pruned = await client!.query('select public.prune_superseded_crm_lead_revisions($1) as deleted', [crmLeadId]);
      const revisions = await client!.query('select revision from public.crm_lead_revisions where crm_lead_id = $1 order by revision', [crmLeadId]);

      expect(pruned.rows).toEqual([{ deleted: 0 }]);
      expect(revisions.rows).toEqual([{ revision: 2 }]);
    } finally {
      await client!.query('delete from public.monday_sync_outbox where crm_lead_id = $1', [crmLeadId]);
      await client!.query('delete from public.crm_leads where id = $1', [crmLeadId]);
    }
  });

  it('does not reapply recorded migrations', async () => {
    const runner = await loadRunner();
    const result = await runner.applyMigrations({ connectionString: grantConnectionString!, migrationsDir });
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
      '018:018_public_schema_rls.sql',
      '019:019_api_rate_limits.sql',
      '020:020_api_rate_limit_retention.sql',
      '021:021_session_consents.sql',
      '022:022_session_consents_append_only.sql',
      '023:023_temporary_session_retention.sql',
      '024:024_temporary_expiry_hardening.sql',
      '025:025_in_flight_handoff_retention.sql',
       '026:026_handoff_claim_ownership.sql',
       '027:027_handoff_send_reservations.sql',
        '028:028_handoff_reservation_consent_recheck.sql',
         '029:029_private_attachment_storage.sql',
         '030:030_private_attachment_retention.sql',
         '031:031_private_attachment_cleanup_hardening.sql',
          '032:032_legacy_cleanup_record_remediation.sql',
          '033:033_private_attachment_live_attestation.sql',
          '034:034_private_attachment_effective_attestation.sql',
           '035:035_schema_migrations_tracker_hardening.sql',
            '036:036_atomic_mutations.sql',
            '037:037_scheduler_health.sql',
            '038:038_durable_deletion_jobs.sql',
            '039:039_deletion_scheduler_health.sql',
            '040:040_deletion_recovery_lifecycle.sql',
            '041:041_deletion_backlog_count.sql',
            '042:042_deletion_recovery_ownership.sql',
               '043:043_deletion_state_batched_cleanup.sql',
               '044:044_monday_crm_projection_tables.sql',
                '045:045_orphaned_private_attachment_cleanup.sql',
                '046:046_claim_next_handoff_qualification.sql',
                 '047:047_atomic_crm_approval.sql',
                 '048:048_monday_sync_state_machine.sql',
                  '049:049_monday_crm_lifecycle.sql',
                  '052:052_monday_scheduler_health.sql',
                  '053:053_monday_reconciliation.sql',
                  '054:054_human_contact_consent.sql',
                  '055:055_final_review_approval.sql'
    ]);
  });

  it('excludes disabled Monday lanes from scheduler freshness checks', async () => {
    const disabled = await client!.query("select public.scheduler_health(false, false, false) as health");
    const enabled = await client!.query("select public.scheduler_health(true, true, true) as health");

    expect(disabled.rows[0].health.stale_workers).not.toContain('monday-dispatch');
    expect(disabled.rows[0].health.stale_workers).not.toContain('monday-lifecycle');
    expect(enabled.rows[0].health.stale_workers).toEqual(expect.arrayContaining(['monday-dispatch', 'monday-lifecycle']));
    expect(enabled.rows[0].health.stale_workers).toContain('monday-reconcile');
  });

  it('hardens a tracker after 018 was already recorded', async () => {
    const { Client } = await import('pg');
    const runner = await loadRunner();
    const database = `balance_assist_tracker_upgrade_${process.pid}_${Date.now()}`;
    const upgradeConnection = withDatabase(connectionString!, database);
    await adminClient!.query(`create database ${database}`);
    try {
      await runner.applyMigrations({ connectionString: upgradeConnection, migrationsDir, throughVersion: '018' });
      const upgradeClient = new Client({ connectionString: upgradeConnection });
      await upgradeClient.connect();
      try {
        await upgradeClient.query('grant all privileges on table public.schema_migrations to public, anon, authenticated');
        const result = await runner.applyMigrations({ connectionString: upgradeConnection, migrationsDir });
        const tracker = await upgradeClient.query(`
          select
            (select relrowsecurity from pg_class where oid = 'public.schema_migrations'::regclass) as rls,
            exists(
              select 1
              from pg_class c
              cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) as acl
              where c.oid = 'public.schema_migrations'::regclass
                and acl.grantee = 0
                and acl.privilege_type = 'SELECT'
            ) as public_select,
            has_table_privilege('anon', 'public.schema_migrations', 'select') as anon_select,
            has_table_privilege('authenticated', 'public.schema_migrations', 'select') as authenticated_select
        `);

        expect(result.applied).toContain('035_schema_migrations_tracker_hardening.sql');
        expect(tracker.rows).toEqual([{
          rls: true,
          public_select: false,
          anon_select: false,
          authenticated_select: false
        }]);
      } finally {
        await upgradeClient.end();
      }
    } finally {
      await adminClient!.query(`drop database if exists ${database}`);
    }
  });

  it('records consent through a locked session and rejects ledger rewrites', async () => {
    const session = await client!.query(
      "insert into public.sessions (source_url) values ('https://example.test') returning id"
    );
    const sessionId = session.rows[0].id;

    try {
      const granted = await client!.query(
        "select * from public.record_session_consent($1, 'analysis', true, '1.0')",
        [sessionId]
      );
      const revoked = await client!.query(
        "select * from public.record_session_consent($1, 'analysis', false, '1.0')",
        [sessionId]
      );
      const ledger = await client!.query(
        'select id from public.session_consents where session_id = $1 order by created_at desc, id desc limit 1',
        [sessionId]
      );

      expect(granted.rows).toEqual([{ analysis: true, human_contact: false, producer_transfer: false }]);
      expect(revoked.rows).toEqual([{ analysis: false, human_contact: false, producer_transfer: false }]);
      await expect(client!.query('update public.session_consents set granted = true where id = $1', [ledger.rows[0].id])).rejects.toThrow('append-only');
      await expect(client!.query('delete from public.session_consents where id = $1', [ledger.rows[0].id])).rejects.toThrow('append-only');
    } finally {
      await deleteSessionForTest(client!, sessionId);
    }
  });

  it('finalizes a session exactly once across concurrent retries using server-calculated qualification', async () => {
    const session = await client!.query(
      `insert into public.sessions (source_url, draft, draft_expires_at)
       values ('https://atomic-finalize.example.test', $1::jsonb, now() + interval '1 hour') returning id`,
      [JSON.stringify({
        service: { value: 'production', provenance: 'confirmed' },
        projectScope: { value: 'A detailed launch film for a new product.', provenance: 'confirmed' },
        timelineBand: { value: '1-2 months', provenance: 'confirmed' },
        budgetBand: { value: '20k-50k', provenance: 'confirmed' },
        contactName: { value: 'Sam', provenance: 'confirmed' },
        contactEmail: { value: 'sam@example.test', provenance: 'confirmed' }
      })]
    );
    const sessionId = session.rows[0].id;
    await client!.query("select public.record_session_consent($1, 'producer_transfer', true, '1.2')", [sessionId]);
    const { Client } = await import('pg');
    const retryClient = new Client({ connectionString: grantConnectionString });
    await retryClient.connect();

    try {
      const [first, second] = await Promise.all([
        client!.query('select * from public.finalize_session_lead($1)', [sessionId]),
        retryClient.query('select * from public.finalize_session_lead($1)', [sessionId])
      ]);
      const persisted = await client!.query(
        `select
           (select count(*) from public.leads where session_id = $1) as leads,
           (select count(*) from public.handoff_outbox where session_id = $1 and idempotency_key = 'finalize:' || $1::text) as approvals,
           (select status from public.sessions where id = $1) as status`,
        [sessionId]
      );

      expect(first.rows[0]).toMatchObject({ persisted: true, qualification_status: 'qualified', score: 10 });
      expect(second.rows[0]).toMatchObject({ persisted: true, qualification_status: 'qualified', score: 10 });
      expect(persisted.rows).toEqual([{ leads: '1', approvals: '1', status: 'completed' }]);
    } finally {
      await retryClient.end();
      await deleteSessionForTest(client!, sessionId);
    }
  });

  it('treats an objective as sufficient project detail for persistence readiness', async () => {
    const session = await client!.query(
      `insert into public.sessions (source_url, draft, draft_expires_at)
       values ('https://objective-finalize.example.test', $1::jsonb, now() + interval '1 hour') returning id`,
      [JSON.stringify({
        projectObjective: { value: 'Build awareness with first-time buyers.', provenance: 'confirmed' },
        contactEmail: { value: 'objective@example.test', provenance: 'confirmed' }
      })]
    );
    const sessionId = session.rows[0].id;
    await client!.query("select public.record_session_consent($1, 'producer_transfer', true, '1.2')", [sessionId]);

    try {
      const finalized = await client!.query('select * from public.finalize_session_lead($1)', [sessionId]);
      const persisted = await client!.query('select lead_draft from public.leads where session_id = $1', [sessionId]);

      expect(finalized.rows[0]).toMatchObject({ persisted: true, consent_required: false });
      expect(persisted.rows[0].lead_draft.projectObjective.value).toBe('Build awareness with first-time buyers.');
    } finally {
      await deleteSessionForTest(client!, sessionId);
    }
  });

  it('atomically snapshots a 1.2-consented canonical draft into one CRM revision and one Monday obligation', async () => {
    const session = await client!.query(
      `insert into public.sessions (source_url, draft, draft_version, draft_expires_at)
       values ('https://crm-approval.example.test', $1::jsonb, 3, now() + interval '1 hour') returning id`,
      [JSON.stringify({
        service: { value: 'production', provenance: 'confirmed' },
        projectScope: { value: 'A detailed launch film for a new product.', provenance: 'confirmed' },
        projectObjective: { value: 'Build launch awareness.', provenance: 'confirmed' },
        audience: { value: 'First-time buyers', provenance: 'confirmed' },
        intendedOutputs: { value: '30-second hero film', provenance: 'confirmed' },
        scopePolished: { value: 'A polished launch film for a new product.', provenance: 'confirmed' },
        referencesStatus: { value: 'added', provenance: 'confirmed' },
        timelineBand: { value: '1-2 months', provenance: 'confirmed' },
        budgetBand: { value: '20k-50k', provenance: 'confirmed' },
        contactName: { value: 'Sam', provenance: 'confirmed' },
        contactEmail: { value: 'sam@example.test', provenance: 'confirmed' }
      })]
    );
    const sessionId = session.rows[0].id;
    await client!.query("select public.record_session_consent($1, 'producer_transfer', true, '1.2')", [sessionId]);
    await client!.query(
      `insert into public.reference_links (session_id, kind, url) values
       ($1, 'Moodboard', 'https://example.com./references?b=2&a=1'),
       ($1, 'Unsafe', 'https://user:password@example.com/private?token=secret'),
       ($1, 'Internal', 'https://127.0.0.1/private')`,
      [sessionId]
    );

    try {
      const [first, retry] = await Promise.all([
        client!.query('select * from public.finalize_session_lead($1)', [sessionId]),
        client!.query('select * from public.finalize_session_lead($1)', [sessionId])
      ]);
      const projection = await client!.query(
        `select c.desired_revision, c.review_due_at >= r.approved_at + interval '90 days' as review_due_after_90_days,
                r.source_draft_version, r.consent_notice_version, r.approval_input_hash, r.payload,
                (select count(*) from public.monday_sync_outbox o where o.crm_lead_id = c.id and o.revision = r.revision and o.operation = 'upsert') as monday_rows,
                (select count(*) from public.handoff_outbox h where h.session_id = $1 and h.idempotency_key = 'finalize:' || $1::text) as telegram_rows
         from public.crm_leads c
         join public.crm_lead_revisions r on r.crm_lead_id = c.id
         where c.source_session_id = $1`,
        [sessionId]
      );

      expect(first.rows[0]).toMatchObject({ persisted: true, crm_revision: 1, approved_draft_version: 3, crm_queued: true });
      expect(retry.rows[0]).toMatchObject({ persisted: true, crm_revision: 1, approved_draft_version: 3, crm_queued: false });
      const approvedReferenceSetHash = createHash('sha256').update(JSON.stringify([
        { kind: 'Moodboard', url: 'https://example.com/references?a=1&b=2' }
      ])).digest('hex');
      expect(first.rows[0]).toMatchObject({
        approval_input_hash: projection.rows[0].approval_input_hash,
        approved_reference_set_hash: approvedReferenceSetHash
      });
      expect(retry.rows[0]).toMatchObject({
        approval_input_hash: projection.rows[0].approval_input_hash,
        approved_reference_set_hash: approvedReferenceSetHash
      });
      expect(projection.rows).toEqual([expect.objectContaining({ desired_revision: 1, source_draft_version: 3, consent_notice_version: '1.2', monday_rows: '1', telegram_rows: '1' })]);
      expect(projection.rows[0].review_due_after_90_days).toBe(true);
      expect(projection.rows[0].payload).toEqual(expect.objectContaining({
        schemaVersion: 1,
        crmRecordId: expect.any(String),
        approvedRevision: 1,
        approvedDraftVersion: 3,
        approvedAt: expect.any(String),
        producerTransferNoticeVersion: '1.2',
        producerTransferRecordedAt: expect.any(String),
        contactName: 'Sam', contactEmail: 'sam@example.test', company: null,
        service: 'production', projectType: null,
        projectScope: 'A detailed launch film for a new product.', timeline: '1-2 months', budget: '20k-50k',
        projectObjective: 'Build launch awareness.', audience: 'First-time buyers', intendedOutputs: '30-second hero film',
        scopePolished: 'A polished launch film for a new product.', referencesStatus: 'added',
        qualificationStatus: 'qualified', score: 10, recommendedNextStep: 'schedule',
        referenceLinks: [{ url: 'https://example.com/references?a=1&b=2', label: 'Moodboard' }]
      }));
      expect(Object.keys(projection.rows[0].payload).sort()).toEqual([
        'approvedAt', 'approvedDraftVersion', 'approvedRevision', 'audience', 'budget', 'company', 'contactEmail', 'contactName',
        'crmRecordId', 'intendedOutputs', 'producerTransferNoticeVersion', 'producerTransferRecordedAt', 'projectObjective',
        'projectScope', 'projectType', 'qualificationStatus', 'recommendedNextStep', 'referenceLinks', 'referencesStatus',
        'schemaVersion', 'scopePolished', 'score', 'service', 'timeline'
      ]);
    } finally {
      const crm = await client!.query('select id from public.crm_leads where source_session_id = $1', [sessionId]);
      if (crm.rows[0]) {
        await client!.query('delete from public.monday_sync_outbox where crm_lead_id = $1', [crm.rows[0].id]);
        await client!.query('delete from public.crm_leads where id = $1', [crm.rows[0].id]);
      }
      await deleteSessionForTest(client!, sessionId);
    }
  });

  it('never creates a CRM projection for a historical notice or a deletion-requested session', async () => {
    const sessions = await client!.query(
      `insert into public.sessions (source_url, draft, deletion_state) values
       ('https://historical-crm.example.test', $1::jsonb, 'active'),
       ('https://deleted-crm.example.test', $1::jsonb, 'active') returning id`,
      [JSON.stringify({ service: { value: 'production' }, projectScope: { value: 'Detailed project scope for approval.' }, timelineBand: { value: '1 month' }, budgetBand: { value: '20k-50k' }, contactEmail: { value: 'case@example.test' } })]
    );
    const [historical, deleting] = sessions.rows;
    await client!.query("select public.record_session_consent($1, 'producer_transfer', true, '1.0')", [historical.id]);
    await client!.query("select public.record_session_consent($1, 'producer_transfer', true, '1.2')", [deleting.id]);
    await client!.query("update public.sessions set deletion_state = 'requested' where id = $1", [deleting.id]);
    try {
      const historicalResult = await client!.query('select * from public.finalize_session_lead($1)', [historical.id]);
      await expect(client!.query('select * from public.finalize_session_lead($1)', [deleting.id])).rejects.toThrow(/SESSION_DELETION_REQUESTED/);
      const crm = await client!.query('select source_session_id from public.crm_leads where source_session_id = any($1::uuid[])', [sessions.rows.map(({ id }) => id)]);

      expect(historicalResult.rows[0]).toMatchObject({ persisted: false, consent_required: true, crm_record_id: null, crm_queued: false });
      const historicalArtifacts = await client!.query(
        'select (select count(*)::int from public.leads where session_id = $1) as leads, (select count(*)::int from public.handoff_outbox where session_id = $1) as handoffs',
        [historical.id]
      );
      expect(historicalArtifacts.rows[0]).toEqual({ leads: 0, handoffs: 0 });
      expect(crm.rows).toEqual([]);
    } finally {
      await deleteSessionForTest(client!, historical.id);
      await deleteSessionForTest(client!, deleting.id);
    }
  });

  it('creates revision two and one new Monday obligation only after a changed canonical draft is reapproved', async () => {
    const session = await client!.query(
      `insert into public.sessions (source_url, draft) values ('https://reapprove-crm.example.test', $1::jsonb) returning id`,
      [JSON.stringify({ service: { value: 'production' }, projectScope: { value: 'Detailed project scope for approval.' }, timelineBand: { value: '1 month' }, budgetBand: { value: '20k-50k' }, contactEmail: { value: 'reapprove@example.test' } })]
    );
    const sessionId = session.rows[0].id;
    await client!.query("select public.record_session_consent($1, 'producer_transfer', true, '1.2')", [sessionId]);
    try {
      await client!.query('select * from public.finalize_session_lead($1)', [sessionId]);
      await client!.query(
        `update public.sessions set draft = jsonb_set(draft, '{projectScope,value}', '"Changed approved scope."'), draft_version = draft_version + 1 where id = $1`,
        [sessionId]
      );
      const reapproval = await client!.query('select * from public.finalize_session_lead($1)', [sessionId]);
      const crm = await client!.query(
        `select c.desired_revision, count(o.id) filter (where o.operation = 'upsert') as upserts
         from public.crm_leads c join public.monday_sync_outbox o on o.crm_lead_id = c.id
         where c.source_session_id = $1 group by c.id`,
        [sessionId]
      );

      expect(reapproval.rows[0]).toMatchObject({ crm_revision: 2, approved_draft_version: 1, crm_queued: true });
      expect(crm.rows).toEqual([{ desired_revision: 2, upserts: '2' }]);
    } finally {
      const crm = await client!.query('select id from public.crm_leads where source_session_id = $1', [sessionId]);
      if (crm.rows[0]) {
        await client!.query('delete from public.monday_sync_outbox where crm_lead_id = $1', [crm.rows[0].id]);
        await client!.query('delete from public.crm_leads where id = $1', [crm.rows[0].id]);
      }
      await deleteSessionForTest(client!, sessionId);
    }
  });

  it('compares canonical draft versions atomically and returns the winning draft on conflict', async () => {
    const session = await client!.query("insert into public.sessions (source_url) values ('https://atomic-draft.example.test') returning id");
    const sessionId = session.rows[0].id;
    const { Client } = await import('pg');
    const competingClient = new Client({ connectionString: grantConnectionString });
    await competingClient.connect();

    try {
      const [first, second] = await Promise.all([
        client!.query("select * from public.update_session_draft($1, 0, '[{\"field\":\"service\",\"value\":\"production\",\"provenance\":\"confirmed\"}]'::jsonb)", [sessionId]),
        competingClient.query("select * from public.update_session_draft($1, 0, '[{\"field\":\"service\",\"value\":\"animation\",\"provenance\":\"confirmed\"}]'::jsonb)", [sessionId])
      ]);
      const results = [first.rows[0], second.rows[0]];
      const applied = results.find((row) => row.conflict === false);
      const conflict = results.find((row) => row.conflict === true);

      expect(applied).toMatchObject({ draft_version: 1, conflict: false });
      expect(conflict).toMatchObject({ draft_version: 1, conflict: true, draft: applied!.draft });
    } finally {
      await competingClient.end();
      await deleteSessionForTest(client!, sessionId);
    }
  });

  it('persists relay messages and their outbox rows atomically by request identity, not text', async () => {
    const session = await client!.query("insert into public.sessions (source_url, draft_expires_at) values ('https://atomic-relay.example.test', now() + interval '1 hour') returning id");
    const sessionId = session.rows[0].id;
    await client!.query("select public.record_session_consent($1, 'human_contact', true, '1.2')", [sessionId]);
    const { Client } = await import('pg');
    const retryClient = new Client({ connectionString: grantConnectionString });
    await retryClient.connect();

    try {
      const [first, retry] = await Promise.all([
        client!.query("select * from public.relay_human_message($1, 'request-a', 'Same text')", [sessionId]),
        retryClient.query("select * from public.relay_human_message($1, 'request-a', 'Same text')", [sessionId])
      ]);
      const secondMessage = await client!.query("select * from public.relay_human_message($1, 'request-b', 'Same text')", [sessionId]);
      const persisted = await client!.query(
        `select
           (select count(*) from public.human_messages where session_id = $1) as messages,
           (select count(*) from public.handoff_outbox where session_id = $1 and payload->>'messageId' is not null) as handoffs`,
        [sessionId]
      );

      expect(first.rows[0].message_id).toBe(retry.rows[0].message_id);
      expect(secondMessage.rows[0].message_id).not.toBe(first.rows[0].message_id);
      expect(persisted.rows).toEqual([{ messages: '2', handoffs: '2' }]);
    } finally {
      await retryClient.end();
      await deleteSessionForTest(client!, sessionId);
    }
  });

  it('claims and reserves a human-contact relay without producer-transfer consent', async () => {
    const session = await client!.query("insert into public.sessions (source_url, draft_expires_at) values ('https://relay-consent.example.test', now() + interval '1 hour') returning id");
    const sessionId = session.rows[0].id;
    try {
      await client!.query("select * from public.record_session_consent($1, 'human_contact', true, '1.2')", [sessionId]);
      const relay = await client!.query("select * from public.relay_human_message($1, 'human-contact-only', 'Please contact me')", [sessionId]);
      const claim = await client!.query('select * from public.claim_next_handoff()');
      const reserved = await client!.query('select public.reserve_handoff_send($1, $2) as reserved', [relay.rows[0].handoff_id, claim.rows[0].claim_token]);
      const state = await client!.query('select state, last_error from public.handoff_outbox where id = $1', [relay.rows[0].handoff_id]);

      expect(relay.rows[0]).toMatchObject({ persisted: true, consent_required: false });
      expect(claim.rows).toEqual([expect.objectContaining({ id: relay.rows[0].handoff_id, resolution: 'claimed', claim_token: expect.any(String) })]);
      expect(reserved.rows).toEqual([{ reserved: true }]);
      expect(state.rows).toEqual([{ state: 'sending', last_error: null }]);
    } finally {
      await deleteSessionForTest(client!, sessionId);
    }
  });

  it('rejects a claimed human-contact relay when consent is revoked before reservation', async () => {
    const session = await client!.query("insert into public.sessions (source_url, draft_expires_at) values ('https://relay-revocation.example.test', now() + interval '1 hour') returning id");
    const sessionId = session.rows[0].id;
    try {
      await client!.query("select * from public.record_session_consent($1, 'human_contact', true, '1.2')", [sessionId]);
      const relay = await client!.query("select * from public.relay_human_message($1, 'human-contact-revoked', 'Please contact me')", [sessionId]);
      const claim = await client!.query('select * from public.claim_next_handoff()');
      await client!.query("select * from public.record_session_consent($1, 'human_contact', false, '1.2')", [sessionId]);
      const reserved = await client!.query('select public.reserve_handoff_send($1, $2) as reserved', [relay.rows[0].handoff_id, claim.rows[0].claim_token]);
      const state = await client!.query(
        'select state, last_error, claim_token, claim_expires_at from public.handoff_outbox where id = $1',
        [relay.rows[0].handoff_id]
      );

      expect(claim.rows).toEqual([expect.objectContaining({ id: relay.rows[0].handoff_id, resolution: 'claimed', claim_token: expect.any(String) })]);
      expect(reserved.rows).toEqual([{ reserved: false }]);
      expect(state.rows).toEqual([{ state: 'failed', last_error: 'human_contact_revoked', claim_token: null, claim_expires_at: null }]);
    } finally {
      await deleteSessionForTest(client!, sessionId);
    }
  });

  it('does not persist or queue a relay under historical human-contact consent', async () => {
    const session = await client!.query("insert into public.sessions (source_url) values ('https://historical-relay.example.test') returning id");
    const sessionId = session.rows[0].id;
    try {
      await client!.query("select * from public.record_session_consent($1, 'human_contact', true, '1.1')", [sessionId]);
      const relay = await client!.query("select * from public.relay_human_message($1, 'historical-relay', 'Please contact me')", [sessionId]);
      const artifacts = await client!.query(
        'select (select count(*)::int from public.human_messages where session_id = $1) as messages, (select count(*)::int from public.handoff_outbox where session_id = $1) as handoffs',
        [sessionId]
      );

      expect(relay.rows[0]).toMatchObject({ persisted: false, consent_required: true, message_id: null, handoff_id: null });
      expect(artifacts.rows[0]).toEqual({ messages: 0, handoffs: 0 });
    } finally {
      await deleteSessionForTest(client!, sessionId);
    }
  });

  it('keeps human relay persistence frozen after deletion is requested', async () => {
    const session = await client!.query("insert into public.sessions (source_url) values ('https://deleted-relay.example.test') returning id");
    const sessionId = session.rows[0].id;
    try {
      await client!.query("select * from public.record_session_consent($1, 'human_contact', true, '1.2')", [sessionId]);
      await client!.query("update public.sessions set deletion_state = 'requested' where id = $1", [sessionId]);
      await expect(client!.query("select * from public.relay_human_message($1, 'deleted-relay', 'Please contact me')", [sessionId]))
        .rejects.toThrow(/SESSION_DELETION_REQUESTED/);
      const artifacts = await client!.query(
        'select (select count(*)::int from public.human_messages where session_id = $1) as messages, (select count(*)::int from public.handoff_outbox where session_id = $1) as handoffs',
        [sessionId]
      );
      expect(artifacts.rows[0]).toEqual({ messages: 0, handoffs: 0 });
    } finally {
      await deleteSessionForTest(client!, sessionId);
    }
  });

  it('queues CRM deletion when producer-transfer consent is revoked', async () => {
    const session = await client!.query("insert into public.sessions (source_url) values ('https://crm-revocation.example.test') returning id");
    const sessionId = session.rows[0].id;
    const crmLead = await client!.query("insert into public.crm_leads (source_session_id, desired_revision, review_due_at) values ($1, 1, now() + interval '1 day') returning id", [sessionId]);
    const crmLeadId = crmLead.rows[0].id;
    try {
      await client!.query("select * from public.record_session_consent($1, 'producer_transfer', true, '1.2')", [sessionId]);
      await client!.query("select * from public.record_session_consent($1, 'producer_transfer', false, '1.2')", [sessionId]);
      const lead = await client!.query('select lifecycle_state from public.crm_leads where id = $1', [crmLeadId]);
      const deletion = await client!.query("select operation, state from public.monday_sync_outbox where crm_lead_id = $1 and operation = 'delete'", [crmLeadId]);

      expect(lead.rows).toEqual([{ lifecycle_state: 'deletion_requested' }]);
      expect(deletion.rows).toEqual([{ operation: 'delete', state: 'pending' }]);
    } finally {
      await client!.query('delete from public.monday_sync_outbox where crm_lead_id = $1', [crmLeadId]);
      await client!.query('delete from public.crm_leads where id = $1', [crmLeadId]);
      await deleteSessionForTest(client!, sessionId);
    }
  });

  it('isolates deletion recovery cleanup and orphan completion by opaque owner', async () => {
    const sessions = await client!.query(
      `insert into public.sessions (source_url) values
        ('https://deletion-owner-a.example.test'),
        ('https://deletion-owner-b.example.test')
       returning id, cleanup_owner_id`
    );
    const [firstSession, secondSession] = sessions.rows;
    const firstJob = await client!.query('select * from public.request_deletion_job($1)', [firstSession.id]);
    const secondJob = await client!.query('select * from public.request_deletion_job($1)', [secondSession.id]);
    const firstOwner = firstJob.rows[0].cleanup_owner_id;
    const secondOwner = secondJob.rows[0].cleanup_owner_id;

    try {
      expect(firstOwner).toBe(firstSession.cleanup_owner_id);
      expect(secondOwner).toBe(secondSession.cleanup_owner_id);
      expect(firstOwner).not.toBe(secondOwner);
      await client!.query(
        `insert into public.private_attachment_cleanup
          (object_key, bucket, checksum_sha256, retention_expires_at, status, cleanup_owner_id)
         values
          ('recovery-owner-a', 'temporary-attachments', repeat('0', 64), now(), 'pending_cleanup', $1),
          ('recovery-owner-b', 'temporary-attachments', repeat('0', 64), now(), 'pending_cleanup', $2)`,
        [firstOwner, secondOwner]
      );
      const claimedRecovery = await client!.query(
        `select object_key from public.private_attachment_cleanup
         where status = 'pending_cleanup' and cleanup_owner_id = $1
         order by object_key`,
        [firstOwner]
      );
      expect(claimedRecovery.rows).toEqual([{ object_key: 'recovery-owner-a' }]);

      const lease = await client!.query(
        `update public.deletion_jobs
         set state = 'processing', lease_token = gen_random_uuid(), lease_expires_at = now() + interval '5 minutes'
         where id = $1
         returning lease_token`,
        [firstJob.rows[0].id]
      );
      await client!.query('delete from public.sessions where id = $1', [firstSession.id]);
      const blocked = await client!.query('select public.complete_orphaned_deletion_job($1, $2) as completed', [firstJob.rows[0].id, lease.rows[0].lease_token]);
      expect(blocked.rows).toEqual([{ completed: false }]);

      await client!.query("delete from public.private_attachment_cleanup where object_key = 'recovery-owner-a'");
      const completed = await client!.query('select public.complete_orphaned_deletion_job($1, $2) as completed', [firstJob.rows[0].id, lease.rows[0].lease_token]);
      expect(completed.rows).toEqual([{ completed: true }]);
      const unrelated = await client!.query("select object_key from public.private_attachment_cleanup where object_key = 'recovery-owner-b'");
      expect(unrelated.rows).toEqual([{ object_key: 'recovery-owner-b' }]);
    } finally {
      await client!.query('delete from public.sessions where id = $1', [secondSession.id]);
      await client!.query("delete from public.private_attachment_cleanup where object_key = 'recovery-owner-b'");
    }
  });

  it('blocks new upload cleanup reservations after deletion is requested and pages every cleanup obligation', async () => {
    const session = await client!.query("insert into public.sessions (source_url) values ('https://deletion-pagination.example.test') returning id, cleanup_owner_id");
    const sessionId = session.rows[0].id;
    const ownerId = session.rows[0].cleanup_owner_id;
    try {
      await client!.query('select * from public.request_deletion_job($1)', [sessionId]);
      const reservation = await client!.query(
        "select public.reserve_private_attachment_cleanup($1, 'temporary-attachments', 'late-object', repeat('0', 64), now() + interval '1 hour') as reserved",
        [sessionId]
      );
      expect(reservation.rows).toEqual([{ reserved: false }]);

      await client!.query(
        `insert into public.private_attachment_cleanup (object_key, bucket, checksum_sha256, retention_expires_at, status, cleanup_owner_id)
         select 'page-recovery-' || n, 'temporary-attachments', repeat('0', 64), now(), 'pending_cleanup', $1
         from generate_series(1, 1001) n`,
        [ownerId]
      );
      const firstPage = await client!.query(
        "select object_key from public.deletion_recovery_cleanup_page($1, 'temporary-attachments', 1000)",
        [ownerId]
      );
      await client!.query('delete from public.private_attachment_cleanup where object_key = any($1)', [firstPage.rows.map((row) => row.object_key)]);
      const secondPage = await client!.query(
        "select object_key from public.deletion_recovery_cleanup_page($1, 'temporary-attachments', 1000)",
        [ownerId]
      );
      expect(firstPage.rows).toHaveLength(1000);
      expect(secondPage.rows).toHaveLength(1);
    } finally {
      await client!.query('delete from public.sessions where id = $1', [sessionId]);
      await client!.query('delete from public.private_attachment_cleanup where cleanup_owner_id = $1', [ownerId]);
    }
  });
});
