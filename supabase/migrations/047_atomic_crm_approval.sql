-- Approval owns the canonical session snapshot, CRM revision, Monday intent, and
-- existing Telegram handoff in one transaction. Monday delivery remains disabled.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE FUNCTION public.normalize_public_reference_url(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  parts text[];
  host_name text;
  path_part text;
  query_part text;
  query_key text;
  query_value text;
  normalized_query text;
  query_entry text;
  host_ip inet;
BEGIN
  parts := regexp_match(btrim(p_url), '^https://([^/?#@]+)(/[^?#]*)?(\\?[^#]*)?$');
  IF parts IS NULL THEN RETURN NULL; END IF;
  host_name := lower(regexp_replace(parts[1], '\.$', ''));
  path_part := coalesce(parts[2], '');
  query_part := coalesce(parts[3], '');
  IF host_name = '' OR host_name = 'localhost' OR host_name ~ '\.localhost$'
    OR host_name ~ '\.(local|internal|test)$' OR host_name ~ ':' AND host_name !~ '^\[[0-9a-f:.]+\]$' THEN
    RETURN NULL;
  END IF;
  IF host_name ~ '^\[[0-9a-f:.]+\]$' THEN
    host_ip := substring(host_name FROM 2 FOR length(host_name) - 2)::inet;
  ELSIF host_name ~ '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' THEN
    host_ip := host_name::inet;
  ELSIF host_name !~ '^[a-z0-9.-]+$' OR position('.' IN host_name) = 0 THEN
    RETURN NULL;
  END IF;
  IF host_ip IS NOT NULL AND (
    host_ip <<= inet '0.0.0.0/8' OR host_ip <<= inet '10.0.0.0/8' OR host_ip <<= inet '100.64.0.0/10'
    OR host_ip <<= inet '127.0.0.0/8' OR host_ip <<= inet '169.254.0.0/16' OR host_ip <<= inet '172.16.0.0/12'
    OR host_ip <<= inet '192.0.0.0/24' OR host_ip <<= inet '192.168.0.0/16' OR host_ip <<= inet '192.88.99.0/24'
    OR host_ip <<= inet '198.18.0.0/15' OR host_ip <<= inet '198.51.100.0/24' OR host_ip <<= inet '203.0.113.0/24'
    OR host_ip <<= inet '224.0.0.0/3' OR host_ip <<= inet '::/128' OR host_ip <<= inet '::1/128'
    OR host_ip <<= inet '100::/64' OR host_ip <<= inet 'fc00::/7' OR host_ip <<= inet 'fe80::/10'
    OR host_ip <<= inet 'ff00::/8' OR host_ip <<= inet '2001:2::/48' OR host_ip <<= inet '2001:db8::/32'
  ) THEN RETURN NULL; END IF;
  IF query_part <> '' THEN
    FOR query_entry IN SELECT value FROM unnest(string_to_array(substring(query_part FROM 2), '&')) value LOOP
      query_key := lower(replace(split_part(query_entry, '=', 1), '-', '_'));
      IF query_key IN ('signature', 'token', 'secret', 'credential', 'password', 'authorization', 'auth', 'api_key', 'apikey', 'access_key', 'accesskey', 'sig', 'se', 'x_amz_signature', 'x_amz_credential', 'x_amz_security_token', 'x_goog_signature', 'x_goog_credential', 'x_ms_signature') THEN RETURN NULL; END IF;
    END LOOP;
    SELECT string_agg(value, '&' ORDER BY value) INTO normalized_query
    FROM unnest(string_to_array(substring(query_part FROM 2), '&')) value;
    query_part := '?' || normalized_query;
  END IF;
  RETURN 'https://' || host_name || path_part || query_part;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$;

DROP FUNCTION public.finalize_session_lead(uuid);

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
  crm_queued boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_draft jsonb;
  v_service text;
  v_scope text;
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
  v_review_due_at timestamptz;
  v_retention_expires_at timestamptz;
  v_approved_at timestamptz;
  v_monday_sync_id uuid;
  v_crm_queued boolean := false;
BEGIN
  -- The global aggregate order is session, CRM aggregate, then its outbox row.
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;

  SELECT granted, notice_version, created_at INTO v_consent
  FROM public.session_consents
  WHERE session_id = p_session_id AND scope = 'producer_transfer'
  ORDER BY created_at DESC, id DESC
  LIMIT 1;
  IF v_consent.granted IS DISTINCT FROM true THEN
    RETURN QUERY SELECT false, true, null::text, null::integer, null::text, null::bigint, null::uuid, null::uuid, null::integer, null::integer, false;
    RETURN;
  END IF;

  v_draft := v_session.draft;
  v_service := coalesce(v_draft #>> '{service,value}', v_draft->>'service', '');
  v_scope := coalesce(v_draft #>> '{projectScope,value}', v_draft->>'projectScope', '');
  v_timeline := coalesce(v_draft #>> '{timelineBand,value}', v_draft->>'timelineBand', '');
  v_budget := coalesce(v_draft #>> '{budgetBand,value}', v_draft->>'budgetBand', '');
  v_name := coalesce(v_draft #>> '{contactName,value}', v_draft->>'contactName', '');
  v_email := coalesce(v_draft #>> '{contactEmail,value}', v_draft->>'contactEmail', '');
  IF (btrim(v_name) = '' AND btrim(v_email) = '') OR (btrim(v_service) = '' AND btrim(v_scope) = '' AND btrim(v_timeline) = '' AND btrim(v_budget) = '') THEN
    RETURN QUERY SELECT false, false, null::text, null::integer, null::text, null::bigint, null::uuid, null::uuid, null::integer, null::integer, false;
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

  -- Existing 1.0 grants still authorize the established Telegram handoff, never CRM.
  IF v_session.deletion_state <> 'active' OR v_consent.notice_version <> '1.1' THEN
    RETURN QUERY SELECT true, false, v_status, v_score, v_next, v_lead_id, v_handoff_id, null::uuid, null::integer, null::integer, false;
    RETURN;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('url', normalized_url, 'label', label) ORDER BY normalized_url), '[]'::jsonb)
  INTO v_references
  FROM (
    SELECT normalized_url, nullif(btrim(kind), '') AS label
    FROM public.reference_links
    CROSS JOIN LATERAL public.normalize_public_reference_url(url) AS normalized(normalized_url)
    WHERE session_id = p_session_id AND normalized.normalized_url IS NOT NULL
    ORDER BY normalized.normalized_url
    LIMIT 20
  ) links;
  v_approval_hash := encode(digest(convert_to(v_session.draft_version::text || ':' || v_references::text, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.crm_leads (source_session_id, lead_id, review_due_at, retention_expires_at)
  VALUES (p_session_id, v_lead_id, now(), null)
  ON CONFLICT (source_session_id) DO NOTHING;
  SELECT * INTO v_crm FROM public.crm_leads WHERE source_session_id = p_session_id FOR UPDATE;

  SELECT revision INTO v_revision FROM public.crm_lead_revisions
  WHERE crm_lead_id = v_crm.id AND approval_input_hash = v_approval_hash;
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
      'projectScope', nullif(v_scope, ''), 'timeline', nullif(v_timeline, ''), 'budget', nullif(v_budget, ''),
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
  RETURN QUERY SELECT true, false, v_status, v_score, v_next, v_lead_id, v_handoff_id, v_crm.id, v_revision, v_session.draft_version, v_crm_queued;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_session_lead(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_public_reference_url(text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION public.finalize_session_lead(uuid) FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION public.finalize_session_lead(uuid) FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.finalize_session_lead(uuid) TO service_role; END IF;
END $$;
