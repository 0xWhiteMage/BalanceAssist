BEGIN;
SELECT pg_advisory_xact_lock(90442060);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '059' AND filename = '059_consent_1_2_compatibility.sql') THEN
    RAISE EXCEPTION 'consent 1.2 cutover migration 060 baseline 059 is not recorded with its reviewed filename';
  END IF;
  IF to_regprocedure('public.assert_session_processing_allowed(uuid)') IS NULL
    OR to_regprocedure('public.finalize_session_lead(uuid)') IS NULL THEN
    RAISE EXCEPTION 'consent 1.2 cutover migration 060 baseline function signatures are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '060') THEN
    RAISE EXCEPTION 'reviewed consent 1.2 cutover migration 060 is already recorded';
  END IF;
END $$;

-- BEGIN 060 060_consent_1_2_cutover.sql
CREATE OR REPLACE FUNCTION public.assert_session_processing_allowed(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_deletion_state text; v_analysis record;
BEGIN
  SELECT deletion_state INTO v_deletion_state FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;
  IF v_deletion_state <> 'active' THEN RAISE EXCEPTION 'SESSION_DELETION_REQUESTED' USING ERRCODE = '55000'; END IF;
  SELECT granted, notice_version INTO v_analysis FROM public.session_consents
  WHERE session_id = p_session_id AND scope = 'analysis'
  ORDER BY created_at DESC, id DESC LIMIT 1;
  IF v_analysis.granted IS DISTINCT FROM true OR v_analysis.notice_version IS DISTINCT FROM '1.2' THEN
    RAISE EXCEPTION 'ANALYSIS_CONSENT_REQUIRED' USING ERRCODE = '55000';
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_session_lead(p_session_id uuid)
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
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_draft jsonb;
  v_service text;
  v_scope text;
  v_objective text;
  v_timeline text;
  v_budget text;
  v_name text;
  v_email text;
  v_status text;
  v_score integer;
  v_next text;
  v_has_signal boolean;
  v_consent record;
  v_lead_id bigint;
  v_handoff_id uuid;
  v_crm public.crm_leads%ROWTYPE;
  v_revision integer;
  v_approval_hash text;
  v_payload jsonb;
  v_payload_hash text;
  v_references jsonb;
  v_reference_hash_input text;
  v_reference_set_hash text;
  v_review_due_at timestamptz;
  v_retention_expires_at timestamptz;
  v_approved_at timestamptz;
  v_monday_sync_id uuid;
  v_crm_queued boolean := false;
BEGIN
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;
  IF v_session.deletion_state <> 'active' THEN RAISE EXCEPTION 'SESSION_DELETION_REQUESTED' USING ERRCODE = '55000'; END IF;

  SELECT granted, notice_version, created_at INTO v_consent
  FROM public.session_consents
  WHERE session_id = p_session_id AND scope = 'producer_transfer'
  ORDER BY created_at DESC, id DESC
  LIMIT 1;
  IF v_consent.granted IS DISTINCT FROM true OR v_consent.notice_version IS DISTINCT FROM '1.2' THEN
    RETURN QUERY SELECT false, true, null::text, null::integer, null::text, null::bigint, null::uuid, null::uuid, null::integer, null::integer, false, null::text, null::text;
    RETURN;
  END IF;

  v_draft := v_session.draft;
  v_service := coalesce(v_draft #>> '{service,value}', v_draft->>'service', '');
  v_scope := coalesce(v_draft #>> '{projectScope,value}', v_draft->>'projectScope', '');
  v_objective := coalesce(v_draft #>> '{projectObjective,value}', v_draft->>'projectObjective', '');
  v_timeline := coalesce(v_draft #>> '{timelineBand,value}', v_draft->>'timelineBand', '');
  v_budget := coalesce(v_draft #>> '{budgetBand,value}', v_draft->>'budgetBand', '');
  v_name := coalesce(v_draft #>> '{contactName,value}', v_draft->>'contactName', '');
  v_email := coalesce(v_draft #>> '{contactEmail,value}', v_draft->>'contactEmail', '');
  IF (btrim(v_name) = '' AND btrim(v_email) = '') OR (btrim(v_service) = '' AND btrim(v_scope) = '' AND btrim(v_objective) = '' AND btrim(v_timeline) = '' AND btrim(v_budget) = '') THEN
    RETURN QUERY SELECT false, false, null::text, null::integer, null::text, null::bigint, null::uuid, null::uuid, null::integer, null::integer, false, null::text, null::text;
    RETURN;
  END IF;

  v_score := (CASE WHEN v_service = '' THEN 0 WHEN v_service = 'not-sure-yet' THEN 1 ELSE 2 END)
    + (CASE WHEN v_budget = '' THEN 0 WHEN v_budget IN ('under-20k', 'not-sure-yet') THEN 1 ELSE 2 END)
    + (CASE WHEN v_timeline = '' THEN 0 WHEN lower(v_timeline) ~ 'week|asap|urgent' THEN 1 ELSE 2 END)
    + (CASE WHEN btrim(v_scope) <> '' AND btrim(v_name) <> '' AND btrim(v_email) <> '' THEN 2 WHEN btrim(v_scope) <> '' OR btrim(v_name) <> '' OR btrim(v_email) <> '' THEN 1 ELSE 0 END)
    + (CASE WHEN length(btrim(v_scope)) > 20 AND btrim(v_email) <> '' THEN 2 WHEN btrim(v_scope) <> '' THEN 1 ELSE 0 END);
  v_has_signal := btrim(v_service) <> '' OR btrim(v_scope) <> '' OR btrim(v_name) <> '' OR btrim(v_email) <> '';
  IF v_score >= 8 THEN v_status := 'qualified';
  ELSIF v_score >= 5 THEN v_status := 'needs_review';
  ELSIF NOT v_has_signal OR v_service = '' OR v_budget = '' OR v_timeline = '' THEN v_status := 'unqualified';
  ELSE v_status := 'misfit'; END IF;
  v_next := CASE v_status WHEN 'qualified' THEN 'schedule' WHEN 'needs_review' THEN 'manual_review' WHEN 'misfit' THEN 'redirect' ELSE 'human_followup' END;

  INSERT INTO public.leads (session_id, qualification_status, score, recommended_next_step, lead_draft, contact_name, contact_email, idempotency_key)
  VALUES (p_session_id, v_status, v_score, v_next, v_draft, nullif(v_name, ''), nullif(v_email, ''), 'finalize:' || p_session_id::text)
  ON CONFLICT (idempotency_key) DO UPDATE SET
    qualification_status = EXCLUDED.qualification_status, score = EXCLUDED.score,
    recommended_next_step = EXCLUDED.recommended_next_step, lead_draft = EXCLUDED.lead_draft,
    contact_name = EXCLUDED.contact_name, contact_email = EXCLUDED.contact_email
  RETURNING id INTO v_lead_id;
  UPDATE public.sessions SET status = CASE WHEN v_status = 'qualified' THEN 'completed' ELSE 'escalated' END WHERE id = p_session_id;
  INSERT INTO public.handoff_outbox (session_id, payload, idempotency_key)
  VALUES (p_session_id, jsonb_build_object('sessionId', p_session_id, 'type', 'approval', 'threadId', v_session.telegram_thread_id, 'summary', 'Project brief: ' || coalesce(nullif(v_scope, ''), 'No scope supplied')), 'finalize:' || p_session_id::text)
  ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO v_handoff_id;
  IF v_handoff_id IS NULL THEN SELECT id INTO v_handoff_id FROM public.handoff_outbox WHERE idempotency_key = 'finalize:' || p_session_id::text; END IF;

  SELECT
    coalesce(jsonb_agg(jsonb_build_object('url', normalized_url, 'label', nullif(btrim(kind), '')) ORDER BY normalized_url, kind), '[]'::jsonb),
    '[' || coalesce(string_agg(format('{"kind":%s,"url":%s}', to_json(kind)::text, to_json(normalized_url)::text), ',' ORDER BY normalized_url, kind), '') || ']'
  INTO v_references, v_reference_hash_input
  FROM (
    SELECT normalized_url, kind
    FROM public.reference_links
    CROSS JOIN LATERAL public.normalize_public_reference_url(url) AS normalized(normalized_url)
    WHERE session_id = p_session_id AND normalized.normalized_url IS NOT NULL
    ORDER BY normalized.normalized_url, kind
    LIMIT 20
  ) links;
  v_reference_set_hash := encode(digest(convert_to(v_reference_hash_input, 'UTF8'), 'sha256'), 'hex');
  v_approval_hash := encode(digest(convert_to(v_session.draft_version::text || ':' || v_references::text, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.crm_leads (source_session_id, lead_id, review_due_at, retention_expires_at)
  VALUES (p_session_id, v_lead_id, now(), null)
  ON CONFLICT (source_session_id) DO NOTHING;
  SELECT * INTO v_crm FROM public.crm_leads WHERE source_session_id = p_session_id FOR UPDATE;

  SELECT revision INTO v_revision FROM public.crm_lead_revisions
  WHERE crm_lead_id = v_crm.id AND crm_lead_revisions.approval_input_hash = v_approval_hash;
  IF v_revision IS NULL THEN
    v_revision := v_crm.desired_revision + 1;
    v_approved_at := now();
    v_payload := jsonb_build_object(
      'schemaVersion', 1, 'crmRecordId', v_crm.id, 'approvedRevision', v_revision,
      'approvedDraftVersion', v_session.draft_version,
      'approvedAt', to_char(v_approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'producerTransferNoticeVersion', v_consent.notice_version,
      'producerTransferRecordedAt', to_char(v_consent.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'contactName', nullif(v_name, ''), 'contactEmail', nullif(v_email, ''),
      'company', nullif(coalesce(v_draft #>> '{contactCompany,value}', v_draft->>'contactCompany', ''), ''),
      'service', nullif(v_service, ''), 'projectType', nullif(coalesce(v_draft #>> '{projectType,value}', v_draft->>'projectType', ''), ''),
      'projectScope', nullif(v_scope, ''),
      'projectObjective', nullif(v_objective, ''),
      'audience', nullif(coalesce(v_draft #>> '{audience,value}', v_draft->>'audience', ''), ''),
      'intendedOutputs', nullif(coalesce(v_draft #>> '{intendedOutputs,value}', v_draft->>'intendedOutputs', ''), ''),
      'scopePolished', nullif(coalesce(v_draft #>> '{scopePolished,value}', v_draft->>'scopePolished', ''), ''),
      'referencesStatus', nullif(coalesce(v_draft #>> '{referencesStatus,value}', v_draft->>'referencesStatus', ''), ''),
      'timeline', nullif(v_timeline, ''), 'budget', nullif(v_budget, ''),
      'qualificationStatus', v_status, 'score', v_score, 'recommendedNextStep', v_next,
      'referenceLinks', v_references
    );
    v_payload_hash := encode(digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');
    INSERT INTO public.crm_lead_revisions (crm_lead_id, revision, source_draft_version, approval_input_hash, payload, payload_hash, approved_at, consent_notice_version, consent_recorded_at)
    VALUES (v_crm.id, v_revision, v_session.draft_version, v_approval_hash, v_payload, v_payload_hash, v_approved_at, v_consent.notice_version, v_consent.created_at);
    INSERT INTO public.monday_sync_outbox (crm_lead_id, revision, operation)
    VALUES (v_crm.id, v_revision, 'upsert')
    RETURNING id INTO v_monday_sync_id;
    v_crm_queued := v_monday_sync_id IS NOT NULL;
  END IF;

  v_review_due_at := CASE WHEN v_status = 'qualified' THEN now() + interval '90 days'
    WHEN extract(isodow FROM now()) = 5 THEN now() + interval '3 days'
    WHEN extract(isodow FROM now()) = 6 THEN now() + interval '2 days'
    ELSE now() + interval '1 day' END;
  v_retention_expires_at := CASE WHEN v_status = 'qualified' THEN null ELSE now() + interval '30 days' END;
  UPDATE public.crm_leads SET lead_id = v_lead_id, desired_revision = greatest(desired_revision, v_revision),
    review_due_at = v_review_due_at, retention_expires_at = v_retention_expires_at, updated_at = now()
  WHERE id = v_crm.id;
  RETURN QUERY SELECT true, false, v_status, v_score, v_next, v_lead_id, v_handoff_id, v_crm.id, v_revision, v_session.draft_version, v_crm_queued, v_approval_hash, v_reference_set_hash;
END;
$$;

CREATE OR REPLACE FUNCTION public.relay_human_message(p_session_id uuid, p_request_id text, p_text text)
RETURNS TABLE (persisted boolean, consent_required boolean, message_id bigint, handoff_id uuid, thread_id bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_session public.sessions%ROWTYPE; v_message_id bigint; v_handoff_id uuid; v_human_contact record;
BEGIN
  IF coalesce(btrim(p_request_id), '') = '' THEN RAISE EXCEPTION 'request id required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;
  IF v_session.deletion_state <> 'active' THEN RAISE EXCEPTION 'SESSION_DELETION_REQUESTED' USING ERRCODE = '55000'; END IF;
  SELECT granted, notice_version INTO v_human_contact FROM public.session_consents WHERE session_id = p_session_id AND scope = 'human_contact' ORDER BY created_at DESC, id DESC LIMIT 1;
  IF v_human_contact.granted IS DISTINCT FROM true OR v_human_contact.notice_version IS DISTINCT FROM '1.2' THEN
    RETURN QUERY SELECT false, true, null::bigint, null::uuid, v_session.telegram_thread_id::bigint;
    RETURN;
  END IF;
  INSERT INTO public.human_messages (session_id, sender, text, request_id, telegram_thread_id) VALUES (p_session_id, 'user', p_text, p_request_id, v_session.telegram_thread_id) ON CONFLICT (session_id, request_id) WHERE request_id IS NOT NULL DO NOTHING RETURNING id INTO v_message_id;
  IF v_message_id IS NULL THEN SELECT id INTO v_message_id FROM public.human_messages WHERE session_id = p_session_id AND request_id = p_request_id; END IF;
  INSERT INTO public.handoff_outbox (session_id, payload, idempotency_key) VALUES (p_session_id, jsonb_build_object('sessionId', p_session_id, 'type', 'relay', 'messageId', v_message_id, 'threadId', v_session.telegram_thread_id, 'summary', p_text), 'relay:' || v_message_id::text) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO v_handoff_id;
  IF v_handoff_id IS NULL THEN SELECT id INTO v_handoff_id FROM public.handoff_outbox WHERE idempotency_key = 'relay:' || v_message_id::text; END IF;
  UPDATE public.sessions SET status = 'escalated' WHERE id = p_session_id;
  RETURN QUERY SELECT true, false, v_message_id, v_handoff_id, v_session.telegram_thread_id::bigint;
END; $$;

CREATE OR REPLACE FUNCTION public.reserve_handoff_send(p_handoff_id uuid, p_claim_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE handoff public.handoff_outbox%ROWTYPE; target_session_id uuid; session_state text; required_scope text; consent record;
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
  required_scope := CASE WHEN handoff.payload->>'type' = 'relay' THEN 'human_contact' ELSE 'producer_transfer' END;
  SELECT c.granted, c.notice_version INTO consent FROM public.session_consents c
  WHERE c.session_id = handoff.session_id AND c.scope = required_scope
  ORDER BY c.created_at DESC, c.id DESC LIMIT 1;
  IF consent.granted IS DISTINCT FROM true OR consent.notice_version IS DISTINCT FROM '1.2' THEN
    UPDATE public.handoff_outbox SET state = 'failed', last_error = CASE WHEN required_scope = 'human_contact' THEN 'human_contact_revoked' ELSE 'producer_transfer_revoked' END, claim_expires_at = NULL, claim_token = NULL, updated_at = now()
    WHERE id = p_handoff_id AND state = 'claiming' AND claim_token = p_claim_token;
    RETURN false;
  END IF;
  UPDATE public.handoff_outbox SET state = 'sending', claim_expires_at = now() + interval '90 seconds', updated_at = now()
  WHERE id = p_handoff_id AND state = 'claiming' AND claim_token = p_claim_token AND claim_expires_at > now();
  RETURN FOUND;
END; $$;

REVOKE ALL ON FUNCTION public.assert_session_processing_allowed(uuid), public.finalize_session_lead(uuid), public.relay_human_message(uuid, text, text), public.reserve_handoff_send(uuid, uuid) FROM PUBLIC, anon, authenticated;
-- END 060 060_consent_1_2_cutover.sql

INSERT INTO public.schema_migrations (version, filename) VALUES ('060', '060_consent_1_2_cutover.sql');

DO $$
BEGIN
  IF position('notice_version IS DISTINCT FROM ''1.2''' IN pg_get_functiondef('public.assert_session_processing_allowed(uuid)'::regprocedure)) = 0
    OR position('v_consent.notice_version IS DISTINCT FROM ''1.2''' IN pg_get_functiondef('public.finalize_session_lead(uuid)'::regprocedure)) = 0
    OR position('v_human_contact.notice_version IS DISTINCT FROM ''1.2''' IN pg_get_functiondef('public.relay_human_message(uuid,text,text)'::regprocedure)) = 0
    OR position('v_session.deletion_state <> ''active''' IN pg_get_functiondef('public.relay_human_message(uuid,text,text)'::regprocedure)) = 0
    OR position('consent.notice_version IS DISTINCT FROM ''1.2''' IN pg_get_functiondef('public.reserve_handoff_send(uuid,uuid)'::regprocedure)) = 0
    OR NOT EXISTS (
      SELECT 1 FROM public.schema_migrations
      WHERE version = '060' AND filename = '060_consent_1_2_cutover.sql'
    ) THEN
    RAISE EXCEPTION 'consent 1.2 cutover migration 060 verification failed';
  END IF;
END $$;
COMMIT;
