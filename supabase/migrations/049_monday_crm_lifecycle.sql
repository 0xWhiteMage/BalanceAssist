-- Lifecycle actions retain only an opaque CRM ID, action, and operator case reference.
CREATE TABLE public.crm_lead_lifecycle_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('review_due', 'renewed', 'expired', 'deletion_requested')),
  audit_ref text NOT NULL CHECK (length(trim(audit_ref)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_lead_lifecycle_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.crm_lead_lifecycle_audit FROM PUBLIC;
ALTER TABLE public.crm_lead_lifecycle_audit DROP CONSTRAINT crm_lead_lifecycle_audit_crm_lead_id_fkey;
ALTER TABLE public.crm_lead_lifecycle_audit ADD CONSTRAINT crm_lead_lifecycle_audit_crm_lead_id_fkey
  FOREIGN KEY (crm_lead_id) REFERENCES public.crm_leads(id) ON DELETE CASCADE;

ALTER TABLE public.deletion_jobs ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS deletion_jobs_due_idx ON public.deletion_jobs (next_attempt_at, requested_at)
  WHERE state IN ('requested', 'failed');

-- The 046 worker's output column is named operation; resolve its unqualified
-- validation reference as a column rather than the RETURNS TABLE variable.
ALTER FUNCTION public.claim_next_monday_sync(integer, text[]) SET plpgsql.variable_conflict TO 'use_column';
CREATE OR REPLACE FUNCTION public.claim_next_monday_sync(p_lease_seconds integer)
RETURNS TABLE (id uuid, crm_lead_id uuid, revision integer, operation text, payload jsonb, provider_operation text, target_item_id text, item_name text, frozen_payload_hash text, request_key uuid, claim_token uuid, resolution text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM public.claim_next_monday_sync(p_lease_seconds, ARRAY['upsert', 'delete']::text[]);
$$;

UPDATE public.crm_leads c SET
  review_due_at = coalesce(c.review_due_at, c.created_at + interval '90 days'),
  retention_expires_at = CASE
    WHEN coalesce((SELECT r.payload->>'qualificationStatus' FROM public.crm_lead_revisions r WHERE r.crm_lead_id = c.id ORDER BY r.revision DESC LIMIT 1), '') IN ('needs_review', 'misfit', 'unqualified')
      THEN coalesce(c.retention_expires_at, (SELECT r.approved_at + interval '30 days' FROM public.crm_lead_revisions r WHERE r.crm_lead_id = c.id ORDER BY r.revision DESC LIMIT 1))
    ELSE c.retention_expires_at
  END
WHERE c.lifecycle_state NOT IN ('deleted', 'expired');

-- A revision remains until no provider retry or operator resolution can need its
-- PII payload. Terminal receipts and suppressed work are safe to discard.
CREATE OR REPLACE FUNCTION public.prune_superseded_crm_lead_revisions(p_crm_lead_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE deleted_count integer;
BEGIN
  PERFORM 1 FROM public.crm_leads WHERE id = p_crm_lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  WITH safe_revisions AS (
    SELECT r.revision FROM public.crm_lead_revisions r
    JOIN public.crm_leads l ON l.id = r.crm_lead_id
    WHERE r.crm_lead_id = p_crm_lead_id AND r.revision < l.desired_revision
      AND NOT EXISTS (
        SELECT 1 FROM public.monday_sync_outbox o
        WHERE o.crm_lead_id = r.crm_lead_id AND o.revision = r.revision
          AND o.state IN ('pending', 'claiming', 'sending', 'delivery_unknown', 'conflict', 'failed')
      )
  ), removed_outbox AS (
    DELETE FROM public.monday_sync_outbox o USING safe_revisions s
    WHERE o.crm_lead_id = p_crm_lead_id AND o.revision = s.revision
  )
  DELETE FROM public.crm_lead_revisions r USING safe_revisions s
  WHERE r.crm_lead_id = p_crm_lead_id AND r.revision = s.revision;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.prune_crm_lead_revisions_after_safe_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'crm_leads' THEN
    PERFORM public.prune_superseded_crm_lead_revisions(NEW.id);
  ELSE
    PERFORM public.prune_superseded_crm_lead_revisions(NEW.crm_lead_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER crm_lead_prune_superseded
AFTER UPDATE OF desired_revision ON public.crm_leads
FOR EACH ROW WHEN (NEW.desired_revision > OLD.desired_revision)
EXECUTE FUNCTION public.prune_crm_lead_revisions_after_safe_transition();

CREATE TRIGGER monday_sync_outbox_prune_superseded
AFTER UPDATE OF state ON public.monday_sync_outbox
FOR EACH ROW WHEN (NEW.state IN ('synced', 'suppressed'))
EXECUTE FUNCTION public.prune_crm_lead_revisions_after_safe_transition();

CREATE OR REPLACE FUNCTION public.queue_crm_lead_deletion(p_crm_lead_id uuid, p_audit_ref text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE lead_row public.crm_leads%ROWTYPE;
BEGIN
  SELECT * INTO lead_row FROM public.crm_leads WHERE id = p_crm_lead_id FOR UPDATE;
  IF NOT FOUND OR lead_row.lifecycle_state = 'deleted' THEN RETURN false; END IF;
  UPDATE public.crm_leads SET lifecycle_state = 'deletion_requested', updated_at = now() WHERE id = lead_row.id;
  UPDATE public.monday_sync_outbox SET state = 'suppressed', claim_token = NULL, claim_expires_at = NULL, updated_at = now()
  WHERE crm_lead_id = lead_row.id AND operation = 'upsert' AND state IN ('pending', 'claiming');
  IF lead_row.desired_revision > 0 THEN
    INSERT INTO public.monday_sync_outbox (crm_lead_id, revision, operation)
    VALUES (lead_row.id, lead_row.desired_revision, 'delete')
    ON CONFLICT (crm_lead_id, revision, operation) DO NOTHING;
  END IF;
  INSERT INTO public.crm_lead_lifecycle_audit (crm_lead_id, action, audit_ref)
  VALUES (lead_row.id, 'deletion_requested', left(p_audit_ref, 200));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_session_consent(p_session_id uuid, p_scope text, p_granted boolean, p_notice_version text)
RETURNS TABLE (analysis boolean, producer_transfer boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE lead_row public.crm_leads%ROWTYPE;
BEGIN
  IF p_session_id IS NULL OR p_scope NOT IN ('analysis', 'producer_transfer') OR coalesce(trim(p_notice_version), '') = '' THEN
    RAISE EXCEPTION 'invalid consent transition' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.session_consents (session_id, scope, granted, notice_version, provenance)
  VALUES (p_session_id, p_scope, p_granted, p_notice_version, 'session_capability');
  IF p_scope = 'producer_transfer' AND NOT p_granted THEN
    FOR lead_row IN SELECT * FROM public.crm_leads WHERE source_session_id = p_session_id FOR UPDATE LOOP
      PERFORM public.queue_crm_lead_deletion(lead_row.id, 'system:producer-transfer-revoked');
    END LOOP;
  END IF;
  RETURN QUERY SELECT
    coalesce((SELECT granted FROM public.session_consents WHERE session_id = p_session_id AND scope = 'analysis' ORDER BY created_at DESC, id DESC LIMIT 1), false),
    coalesce((SELECT granted FROM public.session_consents WHERE session_id = p_session_id AND scope = 'producer_transfer' ORDER BY created_at DESC, id DESC LIMIT 1), false);
END;
$$;

CREATE OR REPLACE FUNCTION public.request_deletion_job(p_session_id uuid)
RETURNS public.deletion_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE job public.deletion_jobs%ROWTYPE; lead_row public.crm_leads%ROWTYPE; owner uuid;
BEGIN
  SELECT cleanup_owner_id INTO owner FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.sessions SET deletion_state = 'requested' WHERE id = p_session_id;
  FOR lead_row IN SELECT * FROM public.crm_leads WHERE source_session_id = p_session_id FOR UPDATE LOOP
    PERFORM public.queue_crm_lead_deletion(lead_row.id, 'system:session-deletion-requested');
  END LOOP;
  INSERT INTO public.deletion_jobs (session_id, cleanup_owner_id, next_attempt_at)
  VALUES (p_session_id, owner, now())
  ON CONFLICT (session_id) WHERE session_id IS NOT NULL DO UPDATE SET cleanup_owner_id = EXCLUDED.cleanup_owner_id, next_attempt_at = now(), updated_at = now()
  RETURNING * INTO job;
  RETURN job;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_deletion_job(p_lease_seconds integer DEFAULT 300)
RETURNS public.deletion_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE job public.deletion_jobs%ROWTYPE;
BEGIN
  IF p_lease_seconds NOT BETWEEN 30 AND 600 THEN RAISE EXCEPTION 'lease seconds out of range'; END IF;
  SELECT * INTO job FROM public.deletion_jobs
  WHERE (state IN ('requested', 'failed') AND next_attempt_at <= now())
    OR (state IN ('claimed', 'processing') AND lease_expires_at <= now())
  ORDER BY next_attempt_at, requested_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF job.cleanup_owner_id IS NULL AND job.session_id IS NOT NULL THEN
    UPDATE public.deletion_jobs j SET cleanup_owner_id = s.cleanup_owner_id FROM public.sessions s
    WHERE j.id = job.id AND s.id = job.session_id RETURNING j.* INTO job;
  END IF;
  UPDATE public.deletion_jobs SET state = 'claimed', attempts = job.attempts + 1, lease_token = gen_random_uuid(),
    lease_expires_at = now() + make_interval(secs => p_lease_seconds), claimed_at = now(), updated_at = now()
  WHERE id = job.id RETURNING * INTO job;
  RETURN job;
END;
$$;

CREATE OR REPLACE FUNCTION public.defer_deletion_job(p_job_id uuid, p_lease_token uuid, p_next_attempt_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_next_attempt_at IS NULL OR p_next_attempt_at <= now() OR p_next_attempt_at > now() + interval '24 hours' THEN RETURN false; END IF;
  UPDATE public.deletion_jobs SET state = 'requested', next_attempt_at = p_next_attempt_at, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE id = p_job_id AND state IN ('claimed', 'processing') AND lease_token = p_lease_token;
  RETURN FOUND;
END;
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
    OR EXISTS (SELECT 1 FROM public.private_attachment_cleanup WHERE cleanup_owner_id = owner AND status = 'pending_cleanup')
    OR EXISTS (SELECT 1 FROM public.crm_leads WHERE source_session_id = target_session_id AND lifecycle_state <> 'deleted') THEN RETURN false; END IF;
  DELETE FROM public.sessions WHERE id = target_session_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_expired_crm_leads(p_limit integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE lead_row public.crm_leads%ROWTYPE; queued integer := 0; qualification text;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'invalid lifecycle limit'; END IF;
  FOR lead_row IN SELECT * FROM public.crm_leads
    WHERE lifecycle_state IN ('active', 'review_overdue')
      AND (retention_expires_at <= now() OR review_due_at <= now())
    ORDER BY least(coalesce(retention_expires_at, review_due_at), review_due_at), id FOR UPDATE SKIP LOCKED LIMIT p_limit
  LOOP
    SELECT payload->>'qualificationStatus' INTO qualification FROM public.crm_lead_revisions
    WHERE crm_lead_id = lead_row.id ORDER BY revision DESC LIMIT 1;
    IF qualification IN ('needs_review', 'misfit', 'unqualified') AND lead_row.retention_expires_at <= now() THEN
      PERFORM public.queue_crm_lead_deletion(lead_row.id, 'system:terminal-retention-expired'); queued := queued + 1;
    ELSIF qualification = 'qualified' AND lead_row.lifecycle_state = 'active' AND lead_row.review_due_at <= now() THEN
      UPDATE public.crm_leads SET lifecycle_state = 'review_overdue', updated_at = now() WHERE id = lead_row.id;
      INSERT INTO public.crm_lead_lifecycle_audit (crm_lead_id, action, audit_ref) VALUES (lead_row.id, 'review_due', 'system:review-due'); queued := queued + 1;
    ELSIF qualification = 'qualified' AND lead_row.lifecycle_state = 'review_overdue' AND lead_row.review_due_at + interval '30 days' <= now() THEN
      PERFORM public.queue_crm_lead_deletion(lead_row.id, 'system:review-grace-expired'); queued := queued + 1;
    END IF;
  END LOOP;
  RETURN queued;
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_crm_lead_review(p_crm_record_id uuid, p_audit_ref text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_crm_record_id IS NULL OR coalesce(trim(p_audit_ref), '') = '' THEN RETURN false; END IF;
  UPDATE public.crm_leads SET lifecycle_state = 'active', review_due_at = now() + interval '90 days', retention_expires_at = NULL, updated_at = now()
  WHERE id = p_crm_record_id AND lifecycle_state IN ('active', 'review_overdue');
  IF FOUND THEN INSERT INTO public.crm_lead_lifecycle_audit (crm_lead_id, action, audit_ref) VALUES (p_crm_record_id, 'renewed', left(trim(p_audit_ref), 200)); END IF;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_crm_lead(p_crm_record_id uuid, p_audit_ref text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_crm_record_id IS NULL OR coalesce(trim(p_audit_ref), '') = '' THEN RETURN false; END IF;
  IF NOT public.queue_crm_lead_deletion(p_crm_record_id, left(trim(p_audit_ref), 200)) THEN RETURN false; END IF;
  INSERT INTO public.crm_lead_lifecycle_audit (crm_lead_id, action, audit_ref) VALUES (p_crm_record_id, 'expired', left(trim(p_audit_ref), 200));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_crm_deletion_by_record_id(p_crm_record_id uuid, p_audit_ref text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_crm_record_id IS NULL OR coalesce(trim(p_audit_ref), '') = '' THEN RETURN false; END IF;
  RETURN public.queue_crm_lead_deletion(p_crm_record_id, left(trim(p_audit_ref), 200));
END;
$$;

REVOKE ALL ON FUNCTION public.prune_superseded_crm_lead_revisions(uuid), public.prune_crm_lead_revisions_after_safe_transition(), public.queue_crm_lead_deletion(uuid, text), public.record_session_consent(uuid, text, boolean, text), public.request_deletion_job(uuid), public.claim_deletion_job(integer), public.defer_deletion_job(uuid, uuid, timestamptz), public.delete_session_for_deletion_job(uuid, uuid), public.queue_expired_crm_leads(integer), public.renew_crm_lead_review(uuid, text), public.expire_crm_lead(uuid, text), public.request_crm_deletion_by_record_id(uuid, text), public.claim_next_monday_sync(integer) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION public.prune_superseded_crm_lead_revisions(uuid), public.record_session_consent(uuid, text, boolean, text), public.request_deletion_job(uuid), public.claim_deletion_job(integer), public.defer_deletion_job(uuid, uuid, timestamptz), public.delete_session_for_deletion_job(uuid, uuid), public.queue_expired_crm_leads(integer), public.renew_crm_lead_review(uuid, text), public.expire_crm_lead(uuid, text), public.request_crm_deletion_by_record_id(uuid, text), public.claim_next_monday_sync(integer) FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION public.prune_superseded_crm_lead_revisions(uuid), public.record_session_consent(uuid, text, boolean, text), public.request_deletion_job(uuid), public.claim_deletion_job(integer), public.defer_deletion_job(uuid, uuid, timestamptz), public.delete_session_for_deletion_job(uuid, uuid), public.queue_expired_crm_leads(integer), public.renew_crm_lead_review(uuid, text), public.expire_crm_lead(uuid, text), public.request_crm_deletion_by_record_id(uuid, text), public.claim_next_monday_sync(integer) FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.prune_superseded_crm_lead_revisions(uuid), public.record_session_consent(uuid, text, boolean, text), public.request_deletion_job(uuid), public.claim_deletion_job(integer), public.defer_deletion_job(uuid, uuid, timestamptz), public.delete_session_for_deletion_job(uuid, uuid), public.queue_expired_crm_leads(integer), public.renew_crm_lead_review(uuid, text), public.expire_crm_lead(uuid, text), public.request_crm_deletion_by_record_id(uuid, text), public.claim_next_monday_sync(integer) TO service_role; END IF;
END $$;
