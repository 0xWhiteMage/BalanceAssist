# Private Attachment Storage Setup

Database migrations and the SQL Editor recovery fallback do not create or manage the `temporary-attachments` Storage bucket. Use this ordered recovery sequence:

1. Run the baseline verification query below.
2. Run `supabase/production-recovery-019-037.sql` in the Supabase SQL Editor.
3. Continue only after it commits successfully with no errors.
4. Create `temporary-attachments` in the Supabase Storage dashboard with public access disabled.
5. Run the read-only verification query below.

After the checks pass, set `SUPABASE_PRIVATE_UPLOAD_BUCKET=temporary-attachments` in the server environment.

Do not use SQL to create, alter, delete, grant access to, or add policies for `storage` relations. Do not add browser Storage policies. Service-role server code is the only writer, and the bucket must never expose public URLs.

Readiness is a read-only attestation: `private_attachment_storage_is_ready('temporary-attachments')` confirms that the expected bucket exists, is non-public, has Storage object RLS enabled, and has no browser-role policy. Any failed attestation disables uploads. Files are temporarily retained for up to 24 hours solely to analyse the current same-browser draft and are never sent to the Balance team or Telegram.

Pass only when the tracker query returns exactly 19 rows for 019-037 and every filename matches the expected migration filename. Pass only when the bucket query returns exactly one row with `public = false`. Pass only when the policy query returns zero rows and the readiness query returns `true`.

On any failure, stop. Do not retry blindly and do not apply migrations 038-043.

Baseline verification must pass before running the artifact. Pass only when `tracker_018_recorded` is true and the relation, column, and function checks return zero rows.

```sql
SELECT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '018') AS tracker_018_recorded;

SELECT 'public.sessions' AS required_relation
WHERE to_regclass('public.sessions') IS NULL
UNION ALL SELECT 'public.handoff_outbox'
WHERE to_regclass('public.handoff_outbox') IS NULL
UNION ALL SELECT 'public.uploaded_files'
WHERE to_regclass('public.uploaded_files') IS NULL
UNION ALL SELECT 'public.human_messages'
WHERE to_regclass('public.human_messages') IS NULL
UNION ALL SELECT 'public.leads'
WHERE to_regclass('public.leads') IS NULL;

SELECT 'sessions.id' AS required_column
WHERE NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.sessions') AND attname = 'id' AND attnum > 0 AND NOT attisdropped)
UNION ALL SELECT 'sessions.draft'
WHERE NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.sessions') AND attname = 'draft' AND attnum > 0 AND NOT attisdropped)
UNION ALL SELECT 'handoff_outbox.claim_expires_at'
WHERE NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.handoff_outbox') AND attname = 'claim_expires_at' AND attnum > 0 AND NOT attisdropped)
UNION ALL SELECT 'uploaded_files.status'
WHERE NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.uploaded_files') AND attname = 'status' AND attnum > 0 AND NOT attisdropped)
UNION ALL SELECT 'human_messages.telegram_thread_id'
WHERE NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.human_messages') AND attname = 'telegram_thread_id' AND attnum > 0 AND NOT attisdropped)
UNION ALL SELECT 'leads.idempotency_key'
WHERE NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.leads') AND attname = 'idempotency_key' AND attnum > 0 AND NOT attisdropped);

SELECT 'public.set_updated_at()' AS required_function
WHERE to_regprocedure('public.set_updated_at()') IS NULL
UNION ALL SELECT 'gen_random_uuid()'
WHERE to_regprocedure('gen_random_uuid()') IS NULL;
```

Run these read-only checks after the SQL Editor script and bucket creation:

```sql
SELECT version, filename
FROM public.schema_migrations
WHERE version BETWEEN '019' AND '037'
ORDER BY version;

SELECT id, name, public
FROM storage.buckets
WHERE id = 'temporary-attachments';

WITH RECURSIVE memberships(browser_role, role_oid) AS (
  SELECT rolname, oid
  FROM pg_roles
  WHERE rolname IN ('anon', 'authenticated')
  UNION
  SELECT memberships.browser_role, pg_auth_members.roleid
  FROM memberships
  JOIN pg_auth_members ON pg_auth_members.member = memberships.role_oid
), role_names AS (
  SELECT memberships.browser_role, pg_roles.rolname AS role_name
  FROM memberships
  JOIN pg_roles ON pg_roles.oid = memberships.role_oid
)
SELECT policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND ('public'::name = ANY(roles) OR EXISTS (
    SELECT 1 FROM role_names WHERE role_name = ANY(roles)
  ))
ORDER BY policyname;

SELECT public.private_attachment_storage_is_ready('temporary-attachments');
```
