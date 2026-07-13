-- Legacy clients used session-prefixed paths. Retain their metadata only as an
-- explicit deletion obligation; the authenticated worker removes object then row.
ALTER TABLE public.uploaded_files
  ADD COLUMN IF NOT EXISTS cleanup_required_at timestamptz;

UPDATE public.uploaded_files
SET cleanup_required_at = coalesce(cleanup_required_at, now())
WHERE object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/';

-- Old recovery rows encode the session in object_key. Move recoverable entries
-- into the guarded metadata cleanup path, then remove that linkable record.
INSERT INTO public.uploaded_files (
  session_id, storage_path, original_name, mime_type, size_bytes, object_key,
  checksum_sha256, retention_expires_at, idempotency_key, status, cleanup_required_at
)
SELECT s.id, c.object_key, '[redacted]', null, 0, c.object_key,
       c.checksum_sha256, c.retention_expires_at, gen_random_uuid(), 'stored', now()
FROM public.private_attachment_cleanup c
JOIN public.sessions s ON s.id = substring(c.object_key FROM 1 FOR 36)::uuid
WHERE c.object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
ON CONFLICT (object_key) WHERE object_key IS NOT NULL DO UPDATE
SET cleanup_required_at = coalesce(public.uploaded_files.cleanup_required_at, now());

DELETE FROM public.private_attachment_cleanup c
USING public.uploaded_files u
WHERE c.object_key = u.object_key
  AND u.cleanup_required_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS uploaded_files_cleanup_required_idx
  ON public.uploaded_files (retention_expires_at)
  WHERE cleanup_required_at IS NOT NULL;

DO $$
DECLARE
  policy_row record;
  bucket_private boolean := false;
  policy_safe boolean := false;
  privileges_safe boolean := false;
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    INSERT INTO public.private_attachment_storage_readiness (bucket, status)
    VALUES ('temporary-attachments', 'unavailable')
    ON CONFLICT (bucket) DO UPDATE SET status = EXCLUDED.status;
    RAISE NOTICE 'private attachment Storage schema is unavailable; uploads remain fail-closed';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public)
  VALUES ('temporary-attachments', 'temporary-attachments', false)
  ON CONFLICT (id) DO UPDATE SET public = false;
  EXECUTE 'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE storage.objects FROM PUBLIC';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE storage.objects FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE storage.objects FROM authenticated';
  END IF;

  -- Role identity is deterministic; any browser-role policy is too broad to prove safe.
  FOR policy_row IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND roles && ARRAY['public'::name, 'anon'::name, 'authenticated'::name]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', policy_row.policyname);
  END LOOP;

  SELECT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'temporary-attachments' AND public = false
  ) INTO bucket_private;
  SELECT NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND roles && ARRAY['public'::name, 'anon'::name, 'authenticated'::name]
  ) INTO policy_safe;
  SELECT NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'storage' AND table_name = 'objects'
      AND grantee IN ('PUBLIC', 'anon', 'authenticated')
  ) INTO privileges_safe;

  INSERT INTO public.private_attachment_storage_readiness (bucket, status)
  VALUES ('temporary-attachments', CASE WHEN bucket_private AND policy_safe AND privileges_safe THEN 'ready' ELSE 'unavailable' END)
  ON CONFLICT (bucket) DO UPDATE SET status = EXCLUDED.status;
END $$;
