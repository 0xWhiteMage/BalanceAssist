SELECT m.filename, c.relrowsecurity, pg_get_userbyid(c.relowner) AS owner,
  has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon_table_access,
  has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS authenticated_table_access,
  EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
    WHERE acl.grantee = 0
  ) AS public_table_access
FROM public.schema_migrations m
JOIN pg_class c ON c.oid = 'public.session_upload_reservations'::regclass
WHERE m.version = '061' AND m.filename = '061_api_security_retention_and_upload_quota.sql';

SELECT p.proname, p.prosrc, p.prosecdef, p.proconfig, l.lanname,
  pg_get_userbyid(p.proowner) AS owner, pg_get_function_result(p.oid) AS result,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ) AS public_execute
FROM pg_proc p
JOIN pg_language l ON l.oid = p.prolang
WHERE p.oid IN (
  'public.prune_processed_telegram_updates(interval,integer)'::regprocedure,
  'public.reserve_session_upload_quota(uuid,bigint,bigint)'::regprocedure,
  'public.release_session_upload_quota(uuid)'::regprocedure
)
ORDER BY p.proname;
