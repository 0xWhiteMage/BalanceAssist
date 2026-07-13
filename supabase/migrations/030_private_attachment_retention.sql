-- Storage schema may be unavailable to generic PostgreSQL runners. Record that state so
-- operations remain unavailable until a private bucket can be verified.
CREATE TABLE IF NOT EXISTS public.private_attachment_cleanup (
  object_key text PRIMARY KEY,
  bucket text NOT NULL,
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  retention_expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status = 'pending_cleanup')
);

CREATE TABLE IF NOT EXISTS public.private_attachment_storage_readiness (
  bucket text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('ready', 'unavailable'))
);

ALTER TABLE public.private_attachment_cleanup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_attachment_storage_readiness ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.private_attachment_cleanup, public.private_attachment_storage_readiness FROM PUBLIC;

DO $$
DECLARE policy_row record; bucket_private boolean;
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    INSERT INTO public.private_attachment_storage_readiness (bucket, status)
    VALUES ('temporary-attachments', 'unavailable')
    ON CONFLICT (bucket) DO UPDATE SET status = EXCLUDED.status;
    RAISE NOTICE 'private attachment Storage schema is unavailable; uploads remain fail-closed';
  ELSE
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('temporary-attachments', 'temporary-attachments', false)
    ON CONFLICT (id) DO UPDATE SET public = false;
    EXECUTE 'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
      AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE storage.objects FROM anon, authenticated';
    END IF;
    FOR policy_row IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND (roles && ARRAY['anon'::name, 'authenticated'::name] OR roles && ARRAY['public'::name])
        AND (coalesce(qual, '') ILIKE '%temporary-attachments%'
          OR coalesce(with_check, '') ILIKE '%temporary-attachments%'
          OR coalesce(qual, '') ~* '(^|[^a-z])true([^a-z]|$)'
          OR coalesce(with_check, '') ~* '(^|[^a-z])true([^a-z]|$)')
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', policy_row.policyname);
    END LOOP;
    SELECT NOT public INTO bucket_private FROM storage.buckets WHERE id = 'temporary-attachments';
    INSERT INTO public.private_attachment_storage_readiness (bucket, status)
    VALUES ('temporary-attachments', CASE WHEN bucket_private THEN 'ready' ELSE 'unavailable' END)
    ON CONFLICT (bucket) DO UPDATE SET status = EXCLUDED.status;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.purge_expired_temporary_sessions();
CREATE OR REPLACE FUNCTION public.purge_expired_temporary_sessions(p_deferred_session_ids uuid[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE deleted_count integer; deferred_count integer; released_count integer;
BEGIN
  PERFORM set_config('app.session_purge', 'on', true);
  UPDATE public.handoff_outbox SET state = 'pending', claim_expires_at = NULL, updated_at = now()
  WHERE state = 'claiming' AND claim_expires_at <= now();
  GET DIAGNOSTICS released_count = ROW_COUNT;
  SELECT count(*) INTO deferred_count FROM public.sessions s WHERE s.draft_expires_at <= now()
    AND (s.id = ANY(p_deferred_session_ids) OR EXISTS (SELECT 1 FROM public.handoff_outbox o WHERE o.session_id = s.id AND o.state = 'claiming' AND o.claim_expires_at > now()));
  DELETE FROM public.sessions s WHERE s.draft_expires_at <= now() AND NOT (s.id = ANY(p_deferred_session_ids))
    AND NOT EXISTS (SELECT 1 FROM public.handoff_outbox o WHERE o.session_id = s.id AND o.state = 'claiming' AND o.claim_expires_at > now());
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN jsonb_build_object('deleted_sessions', deleted_count, 'deferred_sessions', deferred_count, 'released_claims', released_count);
END $$;

REVOKE ALL ON FUNCTION public.purge_expired_temporary_sessions(uuid[]) FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.purge_expired_temporary_sessions(uuid[]) TO service_role; END IF; END $$;
