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
