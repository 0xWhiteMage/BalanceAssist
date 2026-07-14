-- A random owner is assigned per session rather than retaining session identity
-- alongside an opaque object key in recovery records.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS cleanup_owner_id uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.deletion_jobs
  ADD COLUMN IF NOT EXISTS cleanup_owner_id uuid;

ALTER TABLE public.private_attachment_cleanup
  ADD COLUMN IF NOT EXISTS cleanup_owner_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_cleanup_owner_id_key
  ON public.sessions (cleanup_owner_id);

CREATE INDEX IF NOT EXISTS private_attachment_cleanup_owner_idx
  ON public.private_attachment_cleanup (cleanup_owner_id)
  WHERE cleanup_owner_id IS NOT NULL;

-- Only an existing metadata row can prove that a legacy recovery record belongs
-- to a current session. Unknown rows remain unowned and are not job-cleaned.
UPDATE public.private_attachment_cleanup c
SET cleanup_owner_id = s.cleanup_owner_id
FROM public.uploaded_files u
JOIN public.sessions s ON s.id = u.session_id
WHERE c.object_key = u.object_key
  AND c.cleanup_owner_id IS NULL;

CREATE OR REPLACE FUNCTION public.private_attachment_cleanup_owner(p_session_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT cleanup_owner_id FROM public.sessions WHERE id = p_session_id;
$$;

CREATE OR REPLACE FUNCTION public.request_deletion_job(p_session_id uuid)
RETURNS public.deletion_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE job public.deletion_jobs%ROWTYPE;
BEGIN
  INSERT INTO public.deletion_jobs (session_id, cleanup_owner_id)
  SELECT id, cleanup_owner_id FROM public.sessions WHERE id = p_session_id
  ON CONFLICT (session_id) WHERE session_id IS NOT NULL DO UPDATE SET
    state = CASE WHEN deletion_jobs.state = 'completed' THEN 'completed' ELSE deletion_jobs.state END,
    cleanup_owner_id = EXCLUDED.cleanup_owner_id,
    updated_at = now()
  RETURNING * INTO job;
  RETURN job;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_deletion_job(p_lease_seconds integer DEFAULT 300)
RETURNS public.deletion_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE job public.deletion_jobs%ROWTYPE;
BEGIN
  SELECT * INTO job FROM public.deletion_jobs
  WHERE state IN ('requested', 'failed') OR (state IN ('claimed', 'processing') AND lease_expires_at <= now())
  ORDER BY requested_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF job.cleanup_owner_id IS NULL AND job.session_id IS NOT NULL THEN
    UPDATE public.deletion_jobs j SET cleanup_owner_id = s.cleanup_owner_id
    FROM public.sessions s
    WHERE j.id = job.id AND s.id = job.session_id
    RETURNING j.* INTO job;
  END IF;
  UPDATE public.deletion_jobs SET state = 'claimed', attempts = job.attempts + 1,
    lease_token = gen_random_uuid(), lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    claimed_at = now(), updated_at = now() WHERE id = job.id RETURNING * INTO job;
  RETURN job;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_orphaned_deletion_job(p_job_id uuid, p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE job public.deletion_jobs%ROWTYPE;
BEGIN
  SELECT * INTO job FROM public.deletion_jobs
  WHERE id = p_job_id AND session_id IS NULL AND state IN ('claimed', 'processing') AND lease_token = p_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.deletion_jobs SET state = 'completed', completed_at = now(), lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE id = job.id
    AND NOT EXISTS (
      SELECT 1 FROM public.private_attachment_cleanup c
      WHERE c.status = 'pending_cleanup'
        AND c.cleanup_owner_id = job.cleanup_owner_id
    );
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.private_attachment_cleanup_owner(uuid), public.request_deletion_job(uuid), public.complete_orphaned_deletion_job(uuid, uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.private_attachment_cleanup_owner(uuid), public.request_deletion_job(uuid), public.complete_orphaned_deletion_job(uuid, uuid) TO service_role;
  END IF;
END $$;
