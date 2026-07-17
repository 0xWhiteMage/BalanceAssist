BEGIN;
SELECT pg_advisory_xact_lock(90442056);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '055' AND filename = '055_final_review_approval.sql') THEN
    RAISE EXCEPTION 'trust controls migration 056 baseline 055 is not recorded with its reviewed filename';
  END IF;
  IF to_regclass('public.sessions') IS NULL OR to_regclass('public.deletion_jobs') IS NULL OR to_regclass('public.session_consents') IS NULL OR to_regclass('public.handoff_outbox') IS NULL OR to_regprocedure('public.finalize_session_lead(uuid)') IS NULL THEN
    RAISE EXCEPTION 'trust controls migration 056 baseline schema signatures are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '056') THEN
    RAISE EXCEPTION 'reviewed trust controls migration 056 is already recorded';
  END IF;
END $$;

-- BEGIN 056 056_trust_centered_session_controls.sql
ALTER TABLE public.deletion_jobs
  ADD COLUMN public_receipt_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN receipt_secret_hash text NOT NULL DEFAULT encode(digest(gen_random_bytes(32), 'sha256'), 'hex');

ALTER TABLE public.deletion_jobs
  ADD CONSTRAINT deletion_jobs_receipt_secret_hash_check
    CHECK (receipt_secret_hash ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX deletion_jobs_public_receipt_id_key
  ON public.deletion_jobs (public_receipt_id);

-- Existing notice-gated AI sessions predate the consent ledger. Backfill only
-- sessions with no analysis transition so a prior withdrawal is never undone.
INSERT INTO public.session_consents (session_id, scope, granted, notice_version, provenance)
SELECT s.id, 'analysis', true, s.consent_version, 'session_capability'
FROM public.sessions s
WHERE s.deletion_state = 'active'
  AND s.consented_at IS NOT NULL
  AND s.consent_version = '1.1'
  AND NOT EXISTS (
    SELECT 1 FROM public.session_consents c
    WHERE c.session_id = s.id AND c.scope = 'analysis'
  );

CREATE FUNCTION public.request_session_deletion(p_session_id uuid, p_receipt_hash text)
RETURNS TABLE (
  receipt_id uuid,
  status text,
  requested_at timestamptz,
  updated_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_job public.deletion_jobs%ROWTYPE;
  v_lead public.crm_leads%ROWTYPE;
BEGIN
  IF p_session_id IS NULL OR p_receipt_hash IS NULL OR p_receipt_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid deletion receipt' USING ERRCODE = '22023';
  END IF;

  -- Existing jobs use the worker's job-then-session lock order. A new request
  -- has no worker-visible job yet, so it proceeds to the session lock directly.
  SELECT * INTO v_job FROM public.deletion_jobs WHERE session_id = p_session_id FOR UPDATE;
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;
  IF FOUND AND v_session.deletion_state <> 'active' AND v_job.receipt_secret_hash <> p_receipt_hash THEN
    RAISE EXCEPTION 'invalid deletion receipt' USING ERRCODE = '22023';
  END IF;

  UPDATE public.sessions
  SET deletion_state = CASE WHEN deletion_state = 'active' THEN 'requested' ELSE deletion_state END
  WHERE id = p_session_id;

  INSERT INTO public.session_consents (session_id, scope, granted, notice_version, provenance)
  SELECT p_session_id, latest.scope, false, latest.notice_version, 'session_capability'
  FROM (
    SELECT DISTINCT ON (c.scope) c.scope, c.granted, c.notice_version
    FROM public.session_consents c
    WHERE c.session_id = p_session_id
      AND c.scope IN ('analysis', 'human_contact', 'producer_transfer')
    ORDER BY c.scope, c.created_at DESC, c.id DESC
  ) latest
  WHERE latest.granted;

  -- A sending reservation may already have crossed the provider boundary.
  UPDATE public.handoff_outbox
  SET state = 'failed', last_error = 'session_deletion_requested',
      claim_token = NULL, claim_expires_at = NULL, updated_at = now()
  WHERE session_id = p_session_id AND state IN ('pending', 'claiming');

  FOR v_lead IN SELECT * FROM public.crm_leads WHERE source_session_id = p_session_id FOR UPDATE LOOP
    PERFORM public.queue_crm_lead_deletion(v_lead.id, 'system:session-deletion-requested');
  END LOOP;

  IF v_job.id IS NULL THEN
    INSERT INTO public.deletion_jobs (session_id, cleanup_owner_id, next_attempt_at, receipt_secret_hash)
    VALUES (p_session_id, v_session.cleanup_owner_id, now(), p_receipt_hash)
    RETURNING * INTO v_job;
  ELSE
    UPDATE public.deletion_jobs
    SET cleanup_owner_id = v_session.cleanup_owner_id,
        receipt_secret_hash = CASE WHEN v_session.deletion_state = 'active' THEN p_receipt_hash ELSE receipt_secret_hash END,
        next_attempt_at = CASE WHEN state IN ('requested', 'failed') THEN now() ELSE next_attempt_at END,
        updated_at = now()
    WHERE id = v_job.id
    RETURNING * INTO v_job;
  END IF;

  RETURN QUERY SELECT v_job.public_receipt_id, v_job.state, v_job.requested_at,
    v_job.updated_at, v_job.completed_at, v_job.failed_at;
END;
$$;

CREATE FUNCTION public.get_session_deletion_status(p_receipt_id uuid, p_receipt_hash text)
RETURNS TABLE (
  receipt_id uuid,
  status text,
  requested_at timestamptz,
  updated_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT j.public_receipt_id, j.state, j.requested_at, j.updated_at, j.completed_at, j.failed_at
  FROM public.deletion_jobs j
  WHERE j.public_receipt_id = p_receipt_id
    AND j.receipt_secret_hash = p_receipt_hash
    AND p_receipt_hash ~ '^[0-9a-f]{64}$';
$$;

ALTER FUNCTION public.record_session_consent(uuid, text, boolean, text)
  RENAME TO record_session_consent_054;

CREATE FUNCTION public.record_session_consent(p_session_id uuid, p_scope text, p_granted boolean, p_notice_version text)
RETURNS TABLE (analysis boolean, human_contact boolean, producer_transfer boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_deletion_state text;
BEGIN
  SELECT deletion_state INTO v_deletion_state FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;
  IF p_granted AND v_deletion_state <> 'active' THEN RAISE EXCEPTION 'SESSION_DELETION_REQUESTED' USING ERRCODE = '55000'; END IF;
  RETURN QUERY SELECT * FROM public.record_session_consent_054(p_session_id, p_scope, p_granted, p_notice_version);
END;
$$;

ALTER FUNCTION public.update_session_draft(uuid, integer, jsonb)
  RENAME TO update_session_draft_036;

CREATE FUNCTION public.update_session_draft(p_session_id uuid, p_expected_draft_version integer, p_fields jsonb)
RETURNS TABLE (draft jsonb, draft_version integer, conflict boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_deletion_state text;
BEGIN
  SELECT deletion_state INTO v_deletion_state FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;
  IF v_deletion_state <> 'active' THEN RAISE EXCEPTION 'SESSION_DELETION_REQUESTED' USING ERRCODE = '55000'; END IF;
  RETURN QUERY SELECT * FROM public.update_session_draft_036(p_session_id, p_expected_draft_version, p_fields);
END;
$$;

CREATE FUNCTION public.clear_session_draft(p_session_id uuid)
RETURNS TABLE (draft jsonb, draft_version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_session public.sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;
  IF v_session.deletion_state <> 'active' THEN RAISE EXCEPTION 'SESSION_DELETION_REQUESTED' USING ERRCODE = '55000'; END IF;
  UPDATE public.sessions
  SET draft = '{}'::jsonb, draft_version = v_session.draft_version + 1,
      last_activity_at = now(), draft_expires_at = now() + interval '24 hours'
  WHERE id = p_session_id;
  RETURN QUERY SELECT '{}'::jsonb, v_session.draft_version + 1;
END;
$$;

CREATE FUNCTION public.assert_session_processing_allowed(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_deletion_state text; v_analysis boolean;
BEGIN
  SELECT deletion_state INTO v_deletion_state FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;
  IF v_deletion_state <> 'active' THEN RAISE EXCEPTION 'SESSION_DELETION_REQUESTED' USING ERRCODE = '55000'; END IF;
  SELECT granted INTO v_analysis FROM public.session_consents
  WHERE session_id = p_session_id AND scope = 'analysis'
  ORDER BY created_at DESC, id DESC LIMIT 1;
  IF v_analysis IS DISTINCT FROM true THEN RAISE EXCEPTION 'ANALYSIS_CONSENT_REQUIRED' USING ERRCODE = '55000'; END IF;
  RETURN true;
END;
$$;

ALTER FUNCTION public.finalize_session_lead(uuid)
  RENAME TO finalize_session_lead_055;

CREATE FUNCTION public.finalize_session_lead(p_session_id uuid)
RETURNS TABLE (
  persisted boolean,
  consent_required boolean,
  qualification_status text,
  score integer,
  recommended_next_step text,
  lead_id bigint,
  handoff_id uuid,
  crm_record_id uuid,
  crm_revision integer,
  approved_draft_version integer,
  crm_queued boolean,
  approval_input_hash text,
  approved_reference_set_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_deletion_state text;
BEGIN
  SELECT deletion_state INTO v_deletion_state FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;
  IF v_deletion_state <> 'active' THEN RAISE EXCEPTION 'SESSION_DELETION_REQUESTED' USING ERRCODE = '55000'; END IF;
  RETURN QUERY SELECT * FROM public.finalize_session_lead_055(p_session_id);
END;
$$;

ALTER FUNCTION public.relay_human_message(uuid, text, text)
  RENAME TO relay_human_message_054;

CREATE FUNCTION public.relay_human_message(p_session_id uuid, p_request_id text, p_text text)
RETURNS TABLE (persisted boolean, consent_required boolean, message_id bigint, handoff_id uuid, thread_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_deletion_state text;
BEGIN
  SELECT deletion_state INTO v_deletion_state FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;
  IF v_deletion_state <> 'active' THEN RAISE EXCEPTION 'SESSION_DELETION_REQUESTED' USING ERRCODE = '55000'; END IF;
  RETURN QUERY SELECT * FROM public.relay_human_message_054(p_session_id, p_request_id, p_text);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_next_handoff()
RETURNS TABLE (id uuid, session_id uuid, payload jsonb, created_at timestamptz, claim_token uuid, resolution text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE handoff public.handoff_outbox%ROWTYPE; session_row public.sessions%ROWTYPE; candidate_id uuid; candidate_session_id uuid; skipped_ids uuid[] := '{}'::uuid[]; consent_granted boolean; now_at timestamptz := now();
BEGIN
  LOOP
    SELECT o.id, o.session_id INTO candidate_id, candidate_session_id FROM public.handoff_outbox o
    WHERE o.id <> ALL(skipped_ids) AND ((o.state = 'pending' AND o.next_attempt_at <= now_at) OR (o.state IN ('claiming', 'sending') AND o.claim_expires_at <= now_at))
    ORDER BY CASE WHEN o.state IN ('claiming', 'sending') THEN 0 ELSE 1 END, o.next_attempt_at, o.created_at
    LIMIT 1;
    IF NOT FOUND THEN RETURN; END IF;
    SELECT s.* INTO session_row FROM public.sessions s WHERE s.id = candidate_session_id FOR KEY SHARE;
    SELECT o.* INTO handoff FROM public.handoff_outbox o
    WHERE o.id = candidate_id AND ((o.state = 'pending' AND o.next_attempt_at <= now_at) OR (o.state IN ('claiming', 'sending') AND o.claim_expires_at <= now_at))
    FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN skipped_ids := array_append(skipped_ids, candidate_id); CONTINUE; END IF;
    IF handoff.state IN ('claiming', 'sending') THEN
      UPDATE public.handoff_outbox o SET state = 'pending', claim_expires_at = NULL, claim_token = NULL, updated_at = now_at WHERE o.id = handoff.id;
    END IF;
    SELECT c.granted INTO consent_granted FROM public.session_consents c
    WHERE c.session_id = handoff.session_id
      AND c.scope = CASE WHEN handoff.payload->>'type' = 'relay' THEN 'human_contact' ELSE 'producer_transfer' END
    ORDER BY c.created_at DESC, c.id DESC LIMIT 1;
    IF session_row.id IS NULL OR session_row.deletion_state <> 'active' OR session_row.draft_expires_at <= now_at OR consent_granted IS DISTINCT FROM true THEN
      UPDATE public.handoff_outbox o SET state = 'failed', last_error = CASE WHEN session_row.deletion_state <> 'active' THEN 'session_deletion_requested' ELSE 'session_unavailable' END, claim_expires_at = NULL, claim_token = NULL, updated_at = now_at WHERE o.id = handoff.id;
      RETURN QUERY SELECT handoff.id, handoff.session_id, handoff.payload, handoff.created_at, NULL::uuid, 'suppressed'::text;
      RETURN;
    END IF;
    UPDATE public.handoff_outbox o SET state = 'claiming', claimed_at = now_at, claim_token = gen_random_uuid(), claim_expires_at = now_at + interval '2 minutes', updated_at = now_at WHERE o.id = handoff.id;
    RETURN QUERY SELECT o.id, o.session_id, o.payload, o.created_at, o.claim_token, 'claimed'::text FROM public.handoff_outbox o WHERE o.id = handoff.id;
    RETURN;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.reserve_handoff_send(p_handoff_id uuid, p_claim_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE handoff public.handoff_outbox%ROWTYPE; target_session_id uuid; session_state text; consent_granted boolean;
BEGIN
  SELECT o.session_id INTO target_session_id FROM public.handoff_outbox o WHERE o.id = p_handoff_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT deletion_state INTO session_state FROM public.sessions WHERE id = target_session_id FOR KEY SHARE;
  SELECT o.* INTO handoff FROM public.handoff_outbox o WHERE o.id = p_handoff_id AND o.session_id = target_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF session_state IS DISTINCT FROM 'active' THEN
    UPDATE public.handoff_outbox SET state = 'failed', last_error = 'session_deletion_requested', claim_expires_at = NULL, claim_token = NULL, updated_at = now()
    WHERE id = p_handoff_id AND state = 'claiming' AND claim_token = p_claim_token;
    RETURN false;
  END IF;
  SELECT c.granted INTO consent_granted FROM public.session_consents c
  WHERE c.session_id = handoff.session_id
    AND c.scope = CASE WHEN handoff.payload->>'type' = 'relay' THEN 'human_contact' ELSE 'producer_transfer' END
  ORDER BY c.created_at DESC, c.id DESC LIMIT 1;
  IF consent_granted IS DISTINCT FROM true THEN
    UPDATE public.handoff_outbox SET state = 'failed', last_error = CASE WHEN handoff.payload->>'type' = 'relay' THEN 'human_contact_revoked' ELSE 'producer_transfer_revoked' END, claim_expires_at = NULL, claim_token = NULL, updated_at = now()
    WHERE id = p_handoff_id AND state = 'claiming' AND claim_token = p_claim_token;
    RETURN false;
  END IF;
  UPDATE public.handoff_outbox SET state = 'sending', claim_expires_at = now() + interval '90 seconds', updated_at = now()
  WHERE id = p_handoff_id AND state = 'claiming' AND claim_token = p_claim_token AND claim_expires_at > now();
  RETURN FOUND;
END; $$;

CREATE FUNCTION public.guard_reference_link_session_active()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE session_state text;
BEGIN
  SELECT deletion_state INTO session_state FROM public.sessions WHERE id = NEW.session_id FOR KEY SHARE;
  IF session_state IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'SESSION_DELETION_REQUESTED' USING ERRCODE = '55000'; END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER reference_links_require_active_session
BEFORE INSERT OR UPDATE ON public.reference_links
FOR EACH ROW EXECUTE FUNCTION public.guard_reference_link_session_active();

REVOKE ALL ON FUNCTION public.request_session_deletion(uuid, text), public.get_session_deletion_status(uuid, text),
  public.record_session_consent(uuid, text, boolean, text), public.update_session_draft(uuid, integer, jsonb),
  public.clear_session_draft(uuid), public.assert_session_processing_allowed(uuid), public.finalize_session_lead(uuid),
  public.relay_human_message(uuid, text, text), public.claim_next_handoff(), public.reserve_handoff_send(uuid, uuid),
  public.record_session_consent_054(uuid, text, boolean, text), public.update_session_draft_036(uuid, integer, jsonb),
  public.finalize_session_lead_055(uuid), public.relay_human_message_054(uuid, text, text), public.guard_reference_link_session_active() FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.request_session_deletion(uuid, text), public.get_session_deletion_status(uuid, text), public.record_session_consent(uuid, text, boolean, text), public.update_session_draft(uuid, integer, jsonb), public.clear_session_draft(uuid), public.assert_session_processing_allowed(uuid), public.finalize_session_lead(uuid), public.relay_human_message(uuid, text, text), public.claim_next_handoff(), public.reserve_handoff_send(uuid, uuid), public.record_session_consent_054(uuid, text, boolean, text), public.update_session_draft_036(uuid, integer, jsonb), public.finalize_session_lead_055(uuid), public.relay_human_message_054(uuid, text, text), public.guard_reference_link_session_active() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.request_session_deletion(uuid, text), public.get_session_deletion_status(uuid, text), public.record_session_consent(uuid, text, boolean, text), public.update_session_draft(uuid, integer, jsonb), public.clear_session_draft(uuid), public.assert_session_processing_allowed(uuid), public.finalize_session_lead(uuid), public.relay_human_message(uuid, text, text), public.claim_next_handoff(), public.reserve_handoff_send(uuid, uuid), public.record_session_consent_054(uuid, text, boolean, text), public.update_session_draft_036(uuid, integer, jsonb), public.finalize_session_lead_055(uuid), public.relay_human_message_054(uuid, text, text), public.guard_reference_link_session_active() FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON FUNCTION public.record_session_consent_054(uuid, text, boolean, text), public.update_session_draft_036(uuid, integer, jsonb), public.finalize_session_lead_055(uuid), public.relay_human_message_054(uuid, text, text) FROM service_role;
    GRANT EXECUTE ON FUNCTION public.request_session_deletion(uuid, text), public.get_session_deletion_status(uuid, text), public.record_session_consent(uuid, text, boolean, text), public.update_session_draft(uuid, integer, jsonb), public.clear_session_draft(uuid), public.assert_session_processing_allowed(uuid), public.finalize_session_lead(uuid), public.relay_human_message(uuid, text, text), public.claim_next_handoff(), public.reserve_handoff_send(uuid, uuid) TO service_role;
  END IF;
END $$;
-- END 056 056_trust_centered_session_controls.sql
INSERT INTO public.schema_migrations (version, filename) VALUES ('056', '056_trust_centered_session_controls.sql');

DO $$
DECLARE finalizer_result text;
BEGIN
  SELECT pg_get_function_result('public.finalize_session_lead(uuid)'::regprocedure) INTO finalizer_result;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'deletion_jobs' AND column_name = 'public_receipt_id')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'deletion_jobs' AND column_name = 'receipt_secret_hash')
    OR to_regprocedure('public.request_session_deletion(uuid,text)') IS NULL
    OR to_regprocedure('public.get_session_deletion_status(uuid,text)') IS NULL
    OR to_regprocedure('public.assert_session_processing_allowed(uuid)') IS NULL
    OR to_regprocedure('public.clear_session_draft(uuid)') IS NULL
    OR finalizer_result IS NULL OR position('approved_reference_set_hash text' IN finalizer_result) = 0
    OR NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '056' AND filename = '056_trust_centered_session_controls.sql') THEN
    RAISE EXCEPTION 'trust controls migration 056 verification failed';
  END IF;
END $$;
COMMIT;
