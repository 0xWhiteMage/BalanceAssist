-- Reserve upload cleanup under the session row lock so deletion atomically
-- closes the reservation gate before external object creation.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS deletion_state text NOT NULL DEFAULT 'active'
  CHECK (deletion_state IN ('active', 'requested', 'deleting'));

CREATE INDEX IF NOT EXISTS uploaded_files_deletion_cleanup_idx
  ON public.uploaded_files (session_id, id)
  WHERE object_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.request_deletion_job(p_session_id uuid)
RETURNS public.deletion_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE job public.deletion_jobs%ROWTYPE; owner uuid;
BEGIN
  SELECT cleanup_owner_id INTO owner FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.sessions SET deletion_state = 'requested' WHERE id = p_session_id;
  INSERT INTO public.deletion_jobs (session_id, cleanup_owner_id)
  VALUES (p_session_id, owner)
  ON CONFLICT (session_id) WHERE session_id IS NOT NULL DO UPDATE SET cleanup_owner_id = EXCLUDED.cleanup_owner_id, updated_at = now()
  RETURNING * INTO job;
  RETURN job;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_private_attachment_cleanup(
  p_session_id uuid, p_bucket text, p_object_key text, p_checksum_sha256 text, p_retention_expires_at timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE owner uuid; state text;
BEGIN
  SELECT cleanup_owner_id, deletion_state INTO owner, state FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR state <> 'active' THEN RETURN false; END IF;
  INSERT INTO public.private_attachment_cleanup (bucket, object_key, checksum_sha256, retention_expires_at, cleanup_owner_id, status)
  VALUES (p_bucket, p_object_key, p_checksum_sha256, p_retention_expires_at, owner, 'pending_cleanup')
  ON CONFLICT (object_key) DO NOTHING;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_deletion_job(p_job_id uuid, p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target_session_id uuid;
BEGIN
  SELECT session_id INTO target_session_id FROM public.deletion_jobs
  WHERE id = p_job_id AND state = 'claimed' AND lease_token = p_lease_token AND lease_expires_at > now() FOR UPDATE;
  IF target_session_id IS NULL THEN RETURN false; END IF;
  UPDATE public.sessions SET deletion_state = 'deleting'
  WHERE id = target_session_id AND deletion_state IN ('requested', 'deleting');
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.deletion_jobs SET state = 'processing', processing_at = now(), updated_at = now() WHERE id = p_job_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.deletion_recovery_cleanup_page(p_cleanup_owner_id uuid, p_bucket text, p_limit integer DEFAULT 100)
RETURNS TABLE(object_key text) LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.object_key FROM public.private_attachment_cleanup c
  WHERE c.cleanup_owner_id = p_cleanup_owner_id AND c.bucket = p_bucket AND c.status = 'pending_cleanup'
  ORDER BY c.object_key LIMIT greatest(1, least(p_limit, 1000));
$$;

CREATE OR REPLACE FUNCTION public.delete_session_for_deletion_job(p_job_id uuid, p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target_session_id uuid; owner uuid;
BEGIN
  SELECT session_id, cleanup_owner_id INTO target_session_id, owner FROM public.deletion_jobs
  WHERE id = p_job_id AND state = 'processing' AND lease_token = p_lease_token AND lease_expires_at > now() FOR UPDATE;
  IF target_session_id IS NULL THEN RETURN false; END IF;
  PERFORM 1 FROM public.sessions WHERE id = target_session_id AND deletion_state = 'deleting' FOR UPDATE;
  IF NOT FOUND OR EXISTS (SELECT 1 FROM public.uploaded_files WHERE session_id = target_session_id AND object_key IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.private_attachment_cleanup WHERE cleanup_owner_id = owner AND status = 'pending_cleanup') THEN RETURN false; END IF;
  DELETE FROM public.sessions WHERE id = target_session_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_deletion_job(p_job_id uuid, p_lease_token uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.deletion_jobs j SET state = 'completed', completed_at = now(), lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE j.id = p_job_id AND j.state = 'processing' AND j.lease_token = p_lease_token
    AND NOT EXISTS (SELECT 1 FROM public.private_attachment_cleanup c WHERE c.cleanup_owner_id = j.cleanup_owner_id AND c.status = 'pending_cleanup')
  RETURNING true;
$$;

REVOKE ALL ON FUNCTION public.request_deletion_job(uuid), public.reserve_private_attachment_cleanup(uuid, text, text, text, timestamptz), public.start_deletion_job(uuid, uuid), public.deletion_recovery_cleanup_page(uuid, text, integer), public.delete_session_for_deletion_job(uuid, uuid), public.complete_deletion_job(uuid, uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.request_deletion_job(uuid), public.reserve_private_attachment_cleanup(uuid, text, text, text, timestamptz), public.start_deletion_job(uuid, uuid), public.deletion_recovery_cleanup_page(uuid, text, integer), public.delete_session_for_deletion_job(uuid, uuid), public.complete_deletion_job(uuid, uuid) TO service_role;
  END IF;
END $$;
