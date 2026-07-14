# Private Attachment Storage Setup

Database migrations and the SQL Editor recovery fallback do not create or manage the `temporary-attachments` Storage bucket. After the SQL Editor script succeeds, create `temporary-attachments` as a private bucket in the Supabase Storage dashboard. Then set `SUPABASE_PRIVATE_UPLOAD_BUCKET=temporary-attachments` in the server environment.

Do not use SQL to create, alter, delete, grant access to, or add policies for `storage` relations. Do not add browser Storage policies. Service-role server code is the only writer, and the bucket must never expose public URLs.

Readiness is a read-only attestation: `private_attachment_storage_is_ready('temporary-attachments')` confirms that the expected bucket exists, is non-public, has Storage object RLS enabled, and has no browser-role policy. Any failed attestation disables uploads. Files are temporarily retained for up to 24 hours solely to analyse the current same-browser draft and are never sent to the Balance team or Telegram.

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
