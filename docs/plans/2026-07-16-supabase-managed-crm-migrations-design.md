# Supabase-Managed CRM Migration Design

## Goal

Apply the reviewed Monday CRM migration range to the hosted Balance Assist
Supabase project without requiring a routable PostgreSQL connection from
GitHub Actions.

## Decision

Use the authenticated Supabase CLI Management API path for the protected CRM
migration workflow. The workflow will execute the existing reviewed SQL
artifact as one transaction through `supabase db query --linked --file`.

The artifact already contains the required safeguards:

- the shared advisory lock;
- the baseline-043 and schema-signature guards;
- the empty reviewed-range guard;
- the exact `044`, `047`, `048`, `049`, `052`, and `053` migration sources;
- migration-record inserts and final verification.

## Workflow

1. The workflow remains dispatch-only, trusted from `main`, and requires an
   immutable commit SHA already ancestral to `main`.
2. The migration job receives only `SUPABASE_ACCESS_TOKEN` from the
   `production-crm-migrations` environment.
3. It verifies the reviewed source hashes and artifact contents locally.
4. It creates the temporary Supabase linked-project reference from the checked
   in production project ref, without storing credentials in the repository.
5. It runs the checked-in SQL artifact through `supabase db query --linked`.

## Security And Operations

- Remove `PRODUCTION_DATABASE_URL` from the CRM migration workflow; it is not
  needed by the Management API transport.
- Keep `PRODUCTION_DATABASE_URL` available to the dormant Monday canary until
  its separate database verification is migrated to a Management API query.
- Do not run the canary until the protected migration run succeeds.
- The SQL artifact remains the only database-changing input and preserves a
  single database transaction.

## Validation

- Unit tests assert that the workflow uses the Management API path and no
  longer injects a direct database URL.
- A local read-only `supabase db query --linked` probe confirms the linked
  production project identity before release.
- The protected workflow's SQL guards provide the final production baseline,
  range-empty, and migration-record checks.
