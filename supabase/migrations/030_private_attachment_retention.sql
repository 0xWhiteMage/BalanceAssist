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

INSERT INTO public.private_attachment_storage_readiness (bucket, status)
VALUES ('temporary-attachments', 'unavailable')
ON CONFLICT (bucket) DO UPDATE SET status = EXCLUDED.status;

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
