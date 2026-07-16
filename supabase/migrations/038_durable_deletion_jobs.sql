CREATE TABLE public.deletion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested', 'claimed', 'processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  requested_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  processing_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX deletion_jobs_session_id_key ON public.deletion_jobs (session_id) WHERE session_id IS NOT NULL;
ALTER TABLE public.deletion_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.deletion_jobs FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.request_deletion_job(p_session_id uuid)
RETURNS public.deletion_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE job public.deletion_jobs%ROWTYPE;
BEGIN
  INSERT INTO public.deletion_jobs (session_id) VALUES (p_session_id)
  ON CONFLICT (session_id) WHERE session_id IS NOT NULL DO UPDATE SET
    state = CASE WHEN deletion_jobs.state = 'completed' THEN 'completed' ELSE deletion_jobs.state END,
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
  UPDATE public.deletion_jobs SET state = 'claimed', attempts = job.attempts + 1,
    lease_token = gen_random_uuid(), lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    claimed_at = now(), updated_at = now() WHERE id = job.id RETURNING * INTO job;
  RETURN job;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_deletion_job(p_job_id uuid, p_lease_token uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.deletion_jobs SET state = 'processing', processing_at = now(), updated_at = now()
  WHERE id = p_job_id AND state = 'claimed' AND lease_token = p_lease_token AND lease_expires_at > now()
  RETURNING true;
$$;

CREATE OR REPLACE FUNCTION public.fail_deletion_job(p_job_id uuid, p_lease_token uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.deletion_jobs SET state = 'failed', failed_at = now(), lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE id = p_job_id AND state IN ('claimed', 'processing') AND lease_token = p_lease_token
  RETURNING true;
$$;

CREATE OR REPLACE FUNCTION public.delete_session_for_deletion_job(p_job_id uuid, p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target_session_id uuid;
BEGIN
  SELECT session_id INTO target_session_id FROM public.deletion_jobs
  WHERE id = p_job_id AND state = 'processing' AND lease_token = p_lease_token AND lease_expires_at > now() FOR UPDATE;
  IF target_session_id IS NULL THEN RETURN false; END IF;
  DELETE FROM public.sessions WHERE id = target_session_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_deletion_job(p_job_id uuid, p_lease_token uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.deletion_jobs SET state = 'completed', completed_at = now(), lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE id = p_job_id AND state = 'processing' AND lease_token = p_lease_token
  RETURNING true;
$$;

REVOKE ALL ON FUNCTION public.request_deletion_job(uuid), public.claim_deletion_job(integer), public.start_deletion_job(uuid, uuid), public.fail_deletion_job(uuid, uuid), public.delete_session_for_deletion_job(uuid, uuid), public.complete_deletion_job(uuid, uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.request_deletion_job(uuid), public.claim_deletion_job(integer), public.start_deletion_job(uuid, uuid), public.fail_deletion_job(uuid, uuid), public.delete_session_for_deletion_job(uuid, uuid), public.complete_deletion_job(uuid, uuid) TO service_role;
  END IF;
END $$;
