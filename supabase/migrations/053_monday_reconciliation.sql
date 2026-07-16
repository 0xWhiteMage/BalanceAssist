CREATE TABLE public.monday_reconciliation_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cursor text,
  scan_started_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.monday_reconciliation_seen (
  checkpoint_id uuid NOT NULL REFERENCES public.monday_reconciliation_checkpoints(id) ON DELETE CASCADE,
  crm_lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  PRIMARY KEY (checkpoint_id, crm_lead_id)
);

ALTER TABLE public.monday_reconciliation_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monday_reconciliation_seen ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.monday_reconciliation_checkpoints, public.monday_reconciliation_seen FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.claim_monday_reconciliation_page()
RETURNS TABLE (id uuid, cursor text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE checkpoint public.monday_reconciliation_checkpoints%ROWTYPE;
BEGIN
  SELECT * INTO checkpoint FROM public.monday_reconciliation_checkpoints
  WHERE completed_at IS NULL AND (lease_expires_at IS NULL OR lease_expires_at <= now())
  ORDER BY scan_started_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    INSERT INTO public.monday_reconciliation_checkpoints (lease_expires_at)
    VALUES (now() + interval '2 minutes') RETURNING * INTO checkpoint;
  ELSE
    UPDATE public.monday_reconciliation_checkpoints SET lease_expires_at = now() + interval '2 minutes', updated_at = now()
    WHERE monday_reconciliation_checkpoints.id = checkpoint.id RETURNING * INTO checkpoint;
  END IF;
  RETURN QUERY SELECT checkpoint.id, checkpoint.cursor;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_monday_reconciled_item(p_checkpoint_id uuid, p_item_id text, p_crm_record_id text, p_active boolean, p_source_drift boolean)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE lead_row public.crm_leads%ROWTYPE; duplicate_seen boolean := false;
BEGIN
  IF coalesce(length(trim(p_item_id)), 0) = 0 OR coalesce(length(trim(p_crm_record_id)), 0) = 0 THEN RETURN 'ignored'; END IF;
  PERFORM 1 FROM public.monday_reconciliation_checkpoints WHERE id = p_checkpoint_id AND completed_at IS NULL AND lease_expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  SELECT * INTO lead_row FROM public.crm_leads WHERE id::text = p_crm_record_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'ignored'; END IF;
  BEGIN
    INSERT INTO public.monday_reconciliation_seen (checkpoint_id, crm_lead_id) VALUES (p_checkpoint_id, lead_row.id);
  EXCEPTION WHEN unique_violation THEN duplicate_seen := true;
  END;
  IF duplicate_seen OR (lead_row.monday_item_id IS NOT NULL AND lead_row.monday_item_id <> p_item_id) THEN
    UPDATE public.monday_sync_outbox SET state = 'conflict', claim_token = NULL, claim_expires_at = NULL, last_error_code = 'monday_duplicate_key_conflict', updated_at = now()
    WHERE crm_lead_id = lead_row.id AND state IN ('pending', 'claiming', 'sending', 'delivery_unknown');
    RETURN 'conflict';
  END IF;
  IF NOT p_active THEN
    UPDATE public.monday_sync_outbox SET state = 'pending', next_attempt_at = now(), claim_token = NULL, claim_expires_at = NULL, last_error_code = 'monday_item_inactive', updated_at = now()
    WHERE crm_lead_id = lead_row.id AND operation = 'upsert' AND state = 'synced';
    RETURN 'repair_enqueued';
  END IF;
  UPDATE public.crm_leads SET monday_item_id = p_item_id, applied_revision = greatest(applied_revision, desired_revision), updated_at = now() WHERE id = lead_row.id;
  UPDATE public.monday_sync_outbox SET state = CASE WHEN p_source_drift THEN 'pending' ELSE 'synced' END,
    claim_token = NULL, claim_expires_at = NULL, next_attempt_at = CASE WHEN p_source_drift THEN now() ELSE next_attempt_at END,
    last_error_code = CASE WHEN p_source_drift THEN 'monday_source_drift' ELSE NULL END, updated_at = now()
  WHERE crm_lead_id = lead_row.id AND operation = 'upsert' AND revision = lead_row.desired_revision AND state IN ('delivery_unknown', 'synced');
  RETURN CASE WHEN p_source_drift THEN 'repair_enqueued' ELSE 'adopted' END;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_monday_reconciliation_cursor(p_checkpoint_id uuid, p_cursor text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.monday_reconciliation_checkpoints SET cursor = p_cursor, lease_expires_at = NULL, updated_at = now()
  WHERE id = p_checkpoint_id AND completed_at IS NULL AND lease_expires_at > now();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_monday_reconciliation(p_checkpoint_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE repaired integer;
BEGIN
  PERFORM 1 FROM public.monday_reconciliation_checkpoints WHERE id = p_checkpoint_id AND completed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  WITH repaired_rows AS (
    UPDATE public.monday_sync_outbox o SET state = 'pending', next_attempt_at = now(), last_error_code = 'monday_item_missing', updated_at = now()
    FROM public.crm_leads l
    WHERE o.crm_lead_id = l.id AND o.operation = 'upsert' AND o.revision = l.desired_revision AND o.state = 'synced'
      AND l.monday_item_id IS NOT NULL AND l.updated_at < (SELECT scan_started_at - interval '5 minutes' FROM public.monday_reconciliation_checkpoints WHERE id = p_checkpoint_id)
      AND NOT EXISTS (SELECT 1 FROM public.monday_reconciliation_seen seen WHERE seen.checkpoint_id = p_checkpoint_id AND seen.crm_lead_id = l.id)
    RETURNING o.id
  ) SELECT count(*) INTO repaired FROM repaired_rows;
  UPDATE public.monday_reconciliation_checkpoints SET completed_at = now(), lease_expires_at = NULL, updated_at = now() WHERE id = p_checkpoint_id;
  RETURN jsonb_build_object('repairs', repaired);
END;
$$;

ALTER TABLE public.scheduler_heartbeats DROP CONSTRAINT scheduler_heartbeats_worker_check;
ALTER TABLE public.scheduler_heartbeats ADD CONSTRAINT scheduler_heartbeats_worker_check CHECK (worker IN ('handoff-dispatch', 'session-expiry', 'deletion-worker', 'monday-dispatch', 'monday-lifecycle', 'monday-reconcile'));

CREATE OR REPLACE FUNCTION public.record_scheduler_heartbeat(p_worker text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_worker NOT IN ('handoff-dispatch', 'session-expiry', 'deletion-worker', 'monday-dispatch', 'monday-lifecycle', 'monday-reconcile') THEN RAISE EXCEPTION 'unknown scheduler worker' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.scheduler_heartbeats (worker, last_seen_at) VALUES (p_worker, now()) ON CONFLICT (worker) DO UPDATE SET last_seen_at = excluded.last_seen_at;
END;
$$;

DROP FUNCTION public.scheduler_health(boolean, boolean);
CREATE FUNCTION public.scheduler_health(
  p_monday_dispatch_enabled boolean DEFAULT false,
  p_monday_lifecycle_enabled boolean DEFAULT false,
  p_monday_reconcile_enabled boolean DEFAULT false
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH required_workers AS (
    SELECT worker, freshness FROM (VALUES
      ('handoff-dispatch'::text, interval '20 minutes'),
      ('session-expiry'::text, interval '20 minutes'),
      ('deletion-worker'::text, interval '20 minutes')
    ) AS base(worker, freshness)
    UNION ALL SELECT 'monday-dispatch', interval '20 minutes' WHERE p_monday_dispatch_enabled
    UNION ALL SELECT 'monday-lifecycle', interval '26 hours' WHERE p_monday_lifecycle_enabled
    UNION ALL SELECT 'monday-reconcile', interval '8 days' WHERE p_monday_reconcile_enabled
  ), stale AS (
    SELECT required_workers.worker FROM required_workers LEFT JOIN public.scheduler_heartbeats heartbeat USING (worker)
    WHERE heartbeat.last_seen_at IS NULL OR heartbeat.last_seen_at < now() - required_workers.freshness
  ), outbox AS (
    SELECT floor(extract(epoch FROM now() - min(created_at)))::integer AS age FROM public.handoff_outbox WHERE state = 'pending'
  ), expiry AS (
    SELECT count(*)::integer AS backlog FROM public.sessions WHERE draft_expires_at <= now()
  ), deletions AS (
    SELECT floor(extract(epoch FROM now() - min(requested_at)))::integer AS age, count(*)::integer AS backlog FROM public.deletion_jobs WHERE state <> 'completed'
  ), monday AS (
    SELECT floor(extract(epoch FROM now() - min(created_at) FILTER (WHERE operation = 'upsert' AND state IN ('pending', 'claiming', 'sending'))))::integer AS oldest_pending,
      count(*) FILTER (WHERE state = 'delivery_unknown')::integer AS delivery_unknown_count,
      count(*) FILTER (WHERE state = 'conflict')::integer AS conflict_count,
      count(*) FILTER (WHERE state = 'failed')::integer AS failed_count,
      count(*) FILTER (WHERE state IN ('claiming', 'sending') AND claim_expires_at <= now())::integer AS expired_lease_count,
      count(*) FILTER (WHERE last_error_code = 'monday_schema_drift')::integer AS schema_incident_count,
      count(*) FILTER (WHERE last_error_code IN ('monday_auth_failed', 'monday_permission_denied'))::integer AS permission_incident_count,
      count(*) FILTER (WHERE last_error_code = 'monday_rate_limited')::integer AS rate_limited_count,
      floor(extract(epoch FROM now() - min(created_at) FILTER (WHERE operation = 'delete' AND state IN ('pending', 'claiming', 'sending', 'delivery_unknown'))))::integer AS oldest_pending_deletion
    FROM public.monday_sync_outbox
  ), reviews AS (
    SELECT count(*)::integer AS overdue_count, floor(extract(epoch FROM now() - min(review_due_at)))::integer AS oldest_overdue FROM public.crm_leads WHERE lifecycle_state = 'review_overdue'
  )
  SELECT jsonb_build_object(
    'healthy', NOT EXISTS (SELECT 1 FROM stale) AND coalesce((SELECT age FROM outbox), 0) <= 900 AND (SELECT backlog FROM expiry) = 0
      AND coalesce((SELECT age FROM deletions), 0) <= 86400
      AND (NOT p_monday_dispatch_enabled OR (coalesce((SELECT oldest_pending FROM monday), 0) <= 900 AND (SELECT delivery_unknown_count FROM monday) = 0 AND (SELECT conflict_count FROM monday) = 0 AND (SELECT failed_count FROM monday) = 0 AND (SELECT expired_lease_count FROM monday) = 0 AND (SELECT schema_incident_count FROM monday) = 0 AND (SELECT permission_incident_count FROM monday) = 0))
      AND (NOT p_monday_lifecycle_enabled OR coalesce((SELECT oldest_overdue FROM reviews), 0) <= 86400),
    'stale_workers', coalesce((SELECT jsonb_agg(worker ORDER BY worker) FROM stale), '[]'::jsonb),
    'oldest_pending_outbox_seconds', (SELECT age FROM outbox), 'expired_session_backlog', (SELECT backlog FROM expiry),
    'oldest_pending_deletion_seconds', (SELECT age FROM deletions), 'pending_deletion_count', (SELECT backlog FROM deletions),
    'oldest_pending_monday_seconds', (SELECT oldest_pending FROM monday), 'monday_delivery_unknown_count', (SELECT delivery_unknown_count FROM monday),
    'monday_conflict_count', (SELECT conflict_count FROM monday), 'monday_failed_count', (SELECT failed_count FROM monday),
    'monday_expired_lease_count', (SELECT expired_lease_count FROM monday), 'monday_schema_incident_count', (SELECT schema_incident_count FROM monday),
    'monday_permission_incident_count', (SELECT permission_incident_count FROM monday), 'monday_rate_limited_count', (SELECT rate_limited_count FROM monday),
    'oldest_pending_monday_deletion_seconds', (SELECT oldest_pending_deletion FROM monday), 'overdue_crm_review_count', (SELECT overdue_count FROM reviews),
    'oldest_overdue_crm_review_seconds', (SELECT oldest_overdue FROM reviews)
  );
$$;

REVOKE ALL ON FUNCTION public.claim_monday_reconciliation_page(), public.record_monday_reconciled_item(uuid, text, text, boolean, boolean), public.record_monday_reconciliation_cursor(uuid, text), public.finish_monday_reconciliation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scheduler_health(boolean, boolean, boolean) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION public.claim_monday_reconciliation_page(), public.record_monday_reconciled_item(uuid, text, text, boolean, boolean), public.record_monday_reconciliation_cursor(uuid, text), public.finish_monday_reconciliation(uuid) FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION public.claim_monday_reconciliation_page(), public.record_monday_reconciled_item(uuid, text, text, boolean, boolean), public.record_monday_reconciliation_cursor(uuid, text), public.finish_monday_reconciliation(uuid) FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.claim_monday_reconciliation_page(), public.record_monday_reconciled_item(uuid, text, text, boolean, boolean), public.record_monday_reconciliation_cursor(uuid, text), public.finish_monday_reconciliation(uuid), public.scheduler_health(boolean, boolean, boolean) TO service_role; END IF;
END $$;
