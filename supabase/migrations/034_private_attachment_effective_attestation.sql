-- Standard Supabase table grants are safe when RLS is enabled and no browser
-- policy applies. Check direct and inherited browser-role policy access at call time.
CREATE OR REPLACE FUNCTION public.private_attachment_storage_is_ready(p_bucket text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  WITH RECURSIVE memberships(browser_role, role_oid) AS (
    SELECT r.rolname, r.oid FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
    UNION
    SELECT mships.browser_role, m.roleid
    FROM memberships mships
    JOIN pg_auth_members m ON m.member = mships.role_oid
  ), role_names AS (
    SELECT m.browser_role, r.rolname AS role_name
    FROM memberships m JOIN pg_roles r ON r.oid = m.role_oid
  )
  SELECT p_bucket = 'temporary-attachments'
    AND to_regclass('storage.buckets') IS NOT NULL
    AND to_regclass('storage.objects') IS NOT NULL
    AND EXISTS (SELECT 1 FROM storage.buckets WHERE id = p_bucket AND public = false)
    AND EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'storage' AND c.relname = 'objects' AND c.relrowsecurity
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
        AND ('public'::name = ANY(p.roles) OR EXISTS (
          SELECT 1 FROM role_names WHERE role_name = ANY(p.roles)
        ))
    );
$$;

REVOKE ALL ON FUNCTION public.private_attachment_storage_is_ready(text) FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.private_attachment_storage_is_ready(text) TO service_role; END IF; END $$;
