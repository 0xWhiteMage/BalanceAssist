# Supabase Storage Recovery Design

## Context

The production project has the baseline schema through migration `018`, an empty
`public.schema_migrations` tracker for later migrations, and no private upload
bucket. Applying the legacy `019-043` SQL bundle fails in `029` because the SQL
Editor role does not own Supabase-managed `storage.objects`.

The live catalog confirms that `storage.objects` has RLS enabled, has no policies,
and is owned by `supabase_storage_admin`. Direct table grants exist for browser
roles, but without an applicable RLS policy they do not permit browser access.

## Decision

Keep migrations `019-037` as the approved non-destructive recovery scope. Do not
apply `038-043` until their separate backup and cleanup-migration attestation is
approved.

Migrations must not alter, grant on, revoke from, or create/drop policies on
Supabase-managed Storage relations. They may only manage application-owned
metadata and evaluate Storage catalog state.

The private `temporary-attachments` bucket will be created through the supported
Storage API as non-public. No browser Storage policies will be created. Server
service-role operations remain the only upload path.

## Execution

1. Add a test proving the migration source contains no mutating SQL against
   `storage.objects` or `storage.buckets`.
2. Update the untracked `029-034` source and generated production bundle to use
   read-only Storage attestation and fail closed when the bucket is absent.
3. Connect directly to the production database, record a final baseline
   inventory, and apply `019-037` in a single transaction with migration records.
4. Create the non-public bucket with the Storage API.
5. Verify migration records, application-owned functions and tables, bucket
   privacy, no browser policies, and fail-closed browser access.

## Failure Handling

Any schema or verification failure rolls back the database transaction and leaves
uploads disabled. Bucket provisioning occurs only after schema success; if it
fails, readiness remains unavailable and no browser policy is introduced.
