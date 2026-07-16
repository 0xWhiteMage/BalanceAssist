ALTER TABLE public.scheduler_heartbeats DROP CONSTRAINT scheduler_heartbeats_worker_check;
ALTER TABLE public.scheduler_heartbeats ADD CONSTRAINT scheduler_heartbeats_worker_check
  CHECK (worker IN ('handoff-dispatch', 'session-expiry', 'deletion-worker', 'monday-dispatch', 'monday-lifecycle'));

CREATE OR REPLACE FUNCTION public.record_scheduler_heartbeat(p_worker text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_worker NOT IN ('handoff-dispatch', 'session-expiry', 'deletion-worker', 'monday-dispatch', 'monday-lifecycle') THEN
    RAISE EXCEPTION 'unknown scheduler worker' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.scheduler_heartbeats (worker, last_seen_at) VALUES (p_worker, now())
  ON CONFLICT (worker) DO UPDATE SET last_seen_at = excluded.last_seen_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.scheduler_health(
  p_monday_dispatch_enabled boolean DEFAULT false,
  p_monday_lifecycle_enabled boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH required_workers AS (
    SELECT worker, freshness FROM (VALUES
      ('handoff-dispatch'::text, interval '20 minutes'),
      ('session-expiry'::text, interval '20 minutes'),
      ('deletion-worker'::text, interval '20 minutes')
    ) AS base(worker, freshness)
    UNION ALL SELECT 'monday-dispatch', interval '20 minutes' WHERE p_monday_dispatch_enabled
    UNION ALL SELECT 'monday-lifecycle', interval '26 hours' WHERE p_monday_lifecycle_enabled
  ), stale AS (
    SELECT required_workers.worker FROM required_workers
    LEFT JOIN public.scheduler_heartbeats heartbeat USING (worker)
    WHERE heartbeat.last_seen_at IS NULL OR heartbeat.last_seen_at < now() - required_workers.freshness
  ), outbox AS (
    SELECT floor(extract(epoch FROM now() - min(created_at)))::integer AS age
    FROM public.handoff_outbox WHERE state = 'pending'
  ), expiry AS (
    SELECT count(*)::integer AS backlog FROM public.sessions WHERE draft_expires_at <= now()
  ), deletions AS (
    SELECT floor(extract(epoch FROM now() - min(requested_at)))::integer AS age,
      count(*)::integer AS backlog
    FROM public.deletion_jobs WHERE state <> 'completed'
  ), monday AS (
    SELECT
      floor(extract(epoch FROM now() - min(created_at) FILTER (WHERE operation = 'upsert' AND state IN ('pending', 'claiming', 'sending'))) )::integer AS oldest_pending,
      count(*) FILTER (WHERE state = 'delivery_unknown')::integer AS delivery_unknown_count,
      count(*) FILTER (WHERE state = 'conflict')::integer AS conflict_count,
      count(*) FILTER (WHERE state = 'failed')::integer AS failed_count,
      count(*) FILTER (WHERE state IN ('claiming', 'sending') AND claim_expires_at <= now())::integer AS expired_lease_count,
      count(*) FILTER (WHERE last_error_code = 'monday_schema_drift')::integer AS schema_incident_count,
      count(*) FILTER (WHERE last_error_code IN ('monday_auth_failed', 'monday_permission_denied'))::integer AS permission_incident_count,
      count(*) FILTER (WHERE last_error_code = 'monday_rate_limited')::integer AS rate_limited_count,
      floor(extract(epoch FROM now() - min(created_at) FILTER (WHERE operation = 'delete' AND state IN ('pending', 'claiming', 'sending', 'delivery_unknown'))) )::integer AS oldest_pending_deletion
    FROM public.monday_sync_outbox
  ), reviews AS (
    SELECT count(*)::integer AS overdue_count,
      floor(extract(epoch FROM now() - min(review_due_at)))::integer AS oldest_overdue
    FROM public.crm_leads WHERE lifecycle_state = 'review_overdue'
  )
  SELECT jsonb_build_object(
    'healthy', NOT EXISTS (SELECT 1 FROM stale)
      AND coalesce((SELECT age FROM outbox), 0) <= 900
      AND (SELECT backlog FROM expiry) = 0
      AND coalesce((SELECT age FROM deletions), 0) <= 86400
      AND (NOT p_monday_dispatch_enabled OR (
        coalesce((SELECT oldest_pending FROM monday), 0) <= 900
        AND (SELECT delivery_unknown_count FROM monday) = 0
        AND (SELECT conflict_count FROM monday) = 0
        AND (SELECT failed_count FROM monday) = 0
        AND (SELECT expired_lease_count FROM monday) = 0
        AND (SELECT schema_incident_count FROM monday) = 0
        AND (SELECT permission_incident_count FROM monday) = 0
      ))
      AND (NOT p_monday_lifecycle_enabled OR coalesce((SELECT oldest_overdue FROM reviews), 0) <= 86400),
    'stale_workers', coalesce((SELECT jsonb_agg(worker ORDER BY worker) FROM stale), '[]'::jsonb),
    'oldest_pending_outbox_seconds', (SELECT age FROM outbox),
    'expired_session_backlog', (SELECT backlog FROM expiry),
    'oldest_pending_deletion_seconds', (SELECT age FROM deletions),
    'pending_deletion_count', (SELECT backlog FROM deletions),
    'oldest_pending_monday_seconds', (SELECT oldest_pending FROM monday),
    'monday_delivery_unknown_count', (SELECT delivery_unknown_count FROM monday),
    'monday_conflict_count', (SELECT conflict_count FROM monday),
    'monday_failed_count', (SELECT failed_count FROM monday),
    'monday_expired_lease_count', (SELECT expired_lease_count FROM monday),
    'monday_schema_incident_count', (SELECT schema_incident_count FROM monday),
    'monday_permission_incident_count', (SELECT permission_incident_count FROM monday),
    'monday_rate_limited_count', (SELECT rate_limited_count FROM monday),
    'oldest_pending_monday_deletion_seconds', (SELECT oldest_pending_deletion FROM monday),
    'overdue_crm_review_count', (SELECT overdue_count FROM reviews),
    'oldest_overdue_crm_review_seconds', (SELECT oldest_overdue FROM reviews)
  );
$$;

REVOKE ALL ON FUNCTION public.record_scheduler_heartbeat(text), public.scheduler_health(boolean, boolean) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.record_scheduler_heartbeat(text), public.scheduler_health(boolean, boolean) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.record_scheduler_heartbeat(text), public.scheduler_health(boolean, boolean) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.record_scheduler_heartbeat(text), public.scheduler_health(boolean, boolean) TO service_role;
  END IF;
END $$;
