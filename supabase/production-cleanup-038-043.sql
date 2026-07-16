BEGIN;
SELECT pg_advisory_xact_lock(90442043);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '037' AND filename = '037_scheduler_health.sql') THEN
    RAISE EXCEPTION 'cleanup migration baseline 037 is not recorded with its reviewed filename';
  END IF;
  IF to_regclass('public.sessions') IS NULL OR to_regclass('public.private_attachment_cleanup') IS NULL OR to_regclass('public.scheduler_heartbeats') IS NULL THEN
    RAISE EXCEPTION 'cleanup migration baseline schema signatures are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE version IN ('038', '039', '040', '041', '042', '043')) THEN
    RAISE EXCEPTION 'reviewed cleanup migration range is not empty';
  END IF;
END $$;

-- BEGIN 038 038_durable_deletion_jobs.sql
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
-- END 038 038_durable_deletion_jobs.sql
INSERT INTO public.schema_migrations (version, filename) VALUES ('038', '038_durable_deletion_jobs.sql');

-- BEGIN 039 039_deletion_scheduler_health.sql
ALTER TABLE public.scheduler_heartbeats DROP CONSTRAINT scheduler_heartbeats_worker_check;
ALTER TABLE public.scheduler_heartbeats ADD CONSTRAINT scheduler_heartbeats_worker_check CHECK (worker IN ('handoff-dispatch', 'session-expiry', 'deletion-worker'));

CREATE OR REPLACE FUNCTION public.record_scheduler_heartbeat(p_worker text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_worker NOT IN ('handoff-dispatch', 'session-expiry', 'deletion-worker') THEN RAISE EXCEPTION 'unknown scheduler worker' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.scheduler_heartbeats (worker, last_seen_at) VALUES (p_worker, now()) ON CONFLICT (worker) DO UPDATE SET last_seen_at = excluded.last_seen_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.scheduler_health()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH stale AS (
    SELECT worker FROM unnest(ARRAY['handoff-dispatch', 'session-expiry', 'deletion-worker']) worker
    LEFT JOIN public.scheduler_heartbeats heartbeat USING (worker)
    WHERE heartbeat.last_seen_at IS NULL OR heartbeat.last_seen_at < now() - interval '20 minutes'
  ), outbox AS (
    SELECT floor(extract(epoch FROM now() - min(created_at)))::integer AS age FROM public.handoff_outbox WHERE state = 'pending'
  ), expiry AS (
    SELECT count(*)::integer AS backlog FROM public.sessions WHERE draft_expires_at <= now()
  ), deletions AS (
    SELECT floor(extract(epoch FROM now() - min(requested_at)))::integer AS age FROM public.deletion_jobs WHERE state <> 'completed'
  )
  SELECT jsonb_build_object(
    'healthy', NOT EXISTS (SELECT 1 FROM stale) AND coalesce((SELECT age FROM outbox), 0) <= 900 AND (SELECT backlog FROM expiry) = 0 AND coalesce((SELECT age FROM deletions), 0) <= 86400,
    'stale_workers', coalesce((SELECT jsonb_agg(worker ORDER BY worker) FROM stale), '[]'::jsonb),
    'oldest_pending_outbox_seconds', (SELECT age FROM outbox),
    'expired_session_backlog', (SELECT backlog FROM expiry),
    'oldest_pending_deletion_seconds', (SELECT age FROM deletions)
  );
$$;

REVOKE ALL ON FUNCTION public.record_scheduler_heartbeat(text), public.scheduler_health() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.record_scheduler_heartbeat(text), public.scheduler_health() TO service_role; END IF;
END $$;
-- END 039 039_deletion_scheduler_health.sql
INSERT INTO public.schema_migrations (version, filename) VALUES ('039', '039_deletion_scheduler_health.sql');

-- BEGIN 040 040_deletion_recovery_lifecycle.sql
CREATE OR REPLACE FUNCTION public.complete_orphaned_deletion_job(p_job_id uuid, p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.deletion_jobs SET state = 'completed', completed_at = now(), lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE id = p_job_id AND session_id IS NULL AND state IN ('claimed', 'processing') AND lease_token = p_lease_token
    AND NOT EXISTS (SELECT 1 FROM public.private_attachment_cleanup WHERE status = 'pending_cleanup');
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.request_deletion_job(uuid), public.complete_orphaned_deletion_job(uuid, uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.request_deletion_job(uuid), public.complete_orphaned_deletion_job(uuid, uuid) TO service_role; END IF;
END $$;
-- END 040 040_deletion_recovery_lifecycle.sql
INSERT INTO public.schema_migrations (version, filename) VALUES ('040', '040_deletion_recovery_lifecycle.sql');

-- BEGIN 041 041_deletion_backlog_count.sql
CREATE OR REPLACE FUNCTION public.scheduler_health()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH stale AS (
    SELECT worker FROM unnest(ARRAY['handoff-dispatch', 'session-expiry', 'deletion-worker']) worker LEFT JOIN public.scheduler_heartbeats heartbeat USING (worker)
    WHERE heartbeat.last_seen_at IS NULL OR heartbeat.last_seen_at < now() - interval '20 minutes'
  ), outbox AS (SELECT floor(extract(epoch FROM now() - min(created_at)))::integer AS age FROM public.handoff_outbox WHERE state = 'pending'),
  expiry AS (SELECT count(*)::integer AS backlog FROM public.sessions WHERE draft_expires_at <= now()),
  deletions AS (SELECT floor(extract(epoch FROM now() - min(requested_at)))::integer AS age, count(*)::integer AS count FROM public.deletion_jobs WHERE state <> 'completed')
  SELECT jsonb_build_object('healthy', NOT EXISTS (SELECT 1 FROM stale) AND coalesce((SELECT age FROM outbox), 0) <= 900 AND (SELECT backlog FROM expiry) = 0 AND coalesce((SELECT age FROM deletions), 0) <= 86400,
    'stale_workers', coalesce((SELECT jsonb_agg(worker ORDER BY worker) FROM stale), '[]'::jsonb), 'oldest_pending_outbox_seconds', (SELECT age FROM outbox),
    'expired_session_backlog', (SELECT backlog FROM expiry), 'oldest_pending_deletion_seconds', (SELECT age FROM deletions), 'pending_deletion_count', (SELECT count FROM deletions));
$$;
REVOKE ALL ON FUNCTION public.scheduler_health() FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.scheduler_health() TO service_role; END IF; END $$;
-- END 041 041_deletion_backlog_count.sql
INSERT INTO public.schema_migrations (version, filename) VALUES ('041', '041_deletion_backlog_count.sql');

-- BEGIN 042 042_deletion_recovery_ownership.sql
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
-- END 042 042_deletion_recovery_ownership.sql
INSERT INTO public.schema_migrations (version, filename) VALUES ('042', '042_deletion_recovery_ownership.sql');

-- BEGIN 043 043_deletion_state_batched_cleanup.sql
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
-- END 043 043_deletion_state_batched_cleanup.sql
INSERT INTO public.schema_migrations (version, filename) VALUES ('043', '043_deletion_state_batched_cleanup.sql');

DO $$
BEGIN
  IF (SELECT count(*) FROM public.schema_migrations WHERE (version, filename) IN (('038', '038_durable_deletion_jobs.sql'), ('039', '039_deletion_scheduler_health.sql'), ('040', '040_deletion_recovery_lifecycle.sql'), ('041', '041_deletion_backlog_count.sql'), ('042', '042_deletion_recovery_ownership.sql'), ('043', '043_deletion_state_batched_cleanup.sql'))) <> 6 THEN
    RAISE EXCEPTION 'cleanup migration verification failed';
  END IF;
END $$;
COMMIT;
