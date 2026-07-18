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
  'public.assert_session_processing_allowed(uuid)'::regprocedure,
  'public.finalize_session_lead(uuid)'::regprocedure,
  'public.relay_human_message(uuid,text,text)'::regprocedure,
  'public.reserve_handoff_send(uuid,uuid)'::regprocedure,
  'public.delete_session_for_deletion_job(uuid,uuid)'::regprocedure
)
  AND EXISTS (
    SELECT 1 FROM public.schema_migrations
    WHERE version = '060' AND filename = '060_consent_1_2_cutover.sql'
  )
ORDER BY p.proname;
