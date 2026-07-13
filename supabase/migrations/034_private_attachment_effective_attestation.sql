-- Browser roles may inherit grants through membership. Check effective table
-- privileges and all policies applicable to each browser role at call time.
CREATE OR REPLACE FUNCTION public.private_attachment_storage_is_ready(p_bucket text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT p_bucket = 'temporary-attachments'
    AND to_regclass('storage.buckets') IS NOT NULL
    AND to_regclass('storage.objects') IS NOT NULL
    AND EXISTS (SELECT 1 FROM storage.buckets WHERE id = p_bucket AND public = false)
    AND NOT EXISTS (
      SELECT 1 FROM pg_roles r
      WHERE r.rolname IN ('anon', 'authenticated')
        AND (has_table_privilege(r.oid, 'storage.objects', 'select')
          OR has_table_privilege(r.oid, 'storage.objects', 'insert')
          OR has_table_privilege(r.oid, 'storage.objects', 'update')
          OR has_table_privilege(r.oid, 'storage.objects', 'delete'))
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies p JOIN pg_roles r ON r.rolname IN ('anon', 'authenticated')
      WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
        AND ('public'::name = ANY(p.roles) OR r.oid = ANY(p.roles) OR EXISTS (
          SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid AND m.roleid = ANY(p.roles)
        ))
    );
$$;

REVOKE ALL ON FUNCTION public.private_attachment_storage_is_ready(text) FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.private_attachment_storage_is_ready(text) TO service_role; END IF; END $$;
