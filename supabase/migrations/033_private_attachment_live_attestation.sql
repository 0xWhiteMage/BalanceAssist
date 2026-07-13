-- Verify current catalog state at upload time. A migration-time status row cannot
-- establish that policies or grants have not drifted since deployment.
CREATE OR REPLACE FUNCTION public.private_attachment_storage_is_ready(p_bucket text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT
    p_bucket = 'temporary-attachments'
    AND to_regclass('storage.buckets') IS NOT NULL
    AND to_regclass('storage.objects') IS NOT NULL
    AND EXISTS (SELECT 1 FROM storage.buckets WHERE id = p_bucket AND public = false)
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND roles && ARRAY['public'::name, 'anon'::name, 'authenticated'::name]
    )
    AND NOT EXISTS (
      SELECT 1 FROM information_schema.role_table_grants
      WHERE table_schema = 'storage' AND table_name = 'objects'
        AND grantee IN ('PUBLIC', 'anon', 'authenticated')
    );
$$;

REVOKE ALL ON FUNCTION public.private_attachment_storage_is_ready(text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.private_attachment_storage_is_ready(text) TO service_role;
  END IF;
END $$;
