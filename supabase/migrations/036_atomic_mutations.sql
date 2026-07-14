-- Database-owned mutations prevent route-level read/write races.

ALTER TABLE public.human_messages
  ADD COLUMN IF NOT EXISTS request_id text;

CREATE UNIQUE INDEX IF NOT EXISTS human_messages_session_request_id_key
  ON public.human_messages (session_id, request_id)
  WHERE request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.update_session_draft(
  p_session_id uuid,
  p_expected_draft_version integer,
  p_fields jsonb
)
RETURNS TABLE (draft jsonb, draft_version integer, conflict boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_draft jsonb;
  v_field jsonb;
  v_name text;
  v_value text;
  v_provenance text;
BEGIN
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;

  IF p_expected_draft_version <> v_session.draft_version THEN
    RETURN QUERY SELECT v_session.draft, v_session.draft_version, true;
    RETURN;
  END IF;

  v_draft := v_session.draft;
  FOR v_field IN SELECT value FROM jsonb_array_elements(p_fields) LOOP
    v_name := v_field->>'field';
    v_value := v_field->>'value';
    v_provenance := v_field->>'provenance';
    IF v_name IS NULL OR v_name = '' OR v_provenance NOT IN ('user-stated', 'inferred', 'confirmed', 'cleared') THEN
      RAISE EXCEPTION 'invalid draft field' USING ERRCODE = '22023';
    END IF;
    v_draft := jsonb_set(v_draft, array[v_name], jsonb_build_object(
      'value', CASE WHEN v_provenance = 'cleared' THEN '' ELSE coalesce(v_value, '') END,
      'provenance', v_provenance,
      'updatedAt', now()::text
    ));
  END LOOP;

  UPDATE public.sessions
  SET draft = v_draft,
      draft_version = v_session.draft_version + 1,
      last_activity_at = now(),
      draft_expires_at = now() + interval '24 hours'
  WHERE id = p_session_id;

  RETURN QUERY SELECT v_draft, v_session.draft_version + 1, false;
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
  handoff_id uuid
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
  v_lead_id bigint;
  v_handoff_id uuid;
  v_has_signal boolean;
  v_producer_transfer boolean;
BEGIN
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;
  SELECT coalesce(granted, false) INTO v_producer_transfer
  FROM public.session_consents
  WHERE session_id = p_session_id AND scope = 'producer_transfer'
  ORDER BY created_at DESC, id DESC LIMIT 1;
  IF NOT coalesce(v_producer_transfer, false) THEN
    RETURN QUERY SELECT false, true, null::text, null::integer, null::text, null::bigint, null::uuid;
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
    RETURN QUERY SELECT false, false, null::text, null::integer, null::text, null::bigint, null::uuid;
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
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_lead_id;
  IF v_lead_id IS NULL THEN SELECT id INTO v_lead_id FROM public.leads WHERE idempotency_key = 'finalize:' || p_session_id::text; END IF;

  UPDATE public.sessions SET status = CASE WHEN v_status = 'qualified' THEN 'completed' ELSE 'escalated' END WHERE id = p_session_id;
  INSERT INTO public.handoff_outbox (session_id, payload, idempotency_key)
  VALUES (p_session_id, jsonb_build_object('sessionId', p_session_id, 'type', 'approval', 'threadId', v_session.telegram_thread_id, 'summary', 'Project brief: ' || coalesce(nullif(v_scope, ''), 'No scope supplied')), 'finalize:' || p_session_id::text)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_handoff_id;
  IF v_handoff_id IS NULL THEN SELECT id INTO v_handoff_id FROM public.handoff_outbox WHERE idempotency_key = 'finalize:' || p_session_id::text; END IF;
  RETURN QUERY SELECT true, false, v_status, v_score, v_next, v_lead_id, v_handoff_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.relay_human_message(p_session_id uuid, p_request_id text, p_text text)
RETURNS TABLE (persisted boolean, consent_required boolean, message_id bigint, handoff_id uuid, thread_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_message_id bigint;
  v_handoff_id uuid;
  v_producer_transfer boolean;
BEGIN
  IF coalesce(btrim(p_request_id), '') = '' THEN RAISE EXCEPTION 'request id required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;
  SELECT coalesce(granted, false) INTO v_producer_transfer FROM public.session_consents WHERE session_id = p_session_id AND scope = 'producer_transfer' ORDER BY created_at DESC, id DESC LIMIT 1;
  IF NOT coalesce(v_producer_transfer, false) THEN RETURN QUERY SELECT false, true, null::bigint, null::uuid, v_session.telegram_thread_id::bigint; RETURN; END IF;
  INSERT INTO public.human_messages (session_id, sender, text, request_id, telegram_thread_id)
  VALUES (p_session_id, 'user', p_text, p_request_id, v_session.telegram_thread_id)
  ON CONFLICT (session_id, request_id) WHERE request_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_message_id;
  IF v_message_id IS NULL THEN SELECT id INTO v_message_id FROM public.human_messages WHERE session_id = p_session_id AND request_id = p_request_id; END IF;
  INSERT INTO public.handoff_outbox (session_id, payload, idempotency_key)
  VALUES (p_session_id, jsonb_build_object('sessionId', p_session_id, 'type', 'relay', 'messageId', v_message_id, 'threadId', v_session.telegram_thread_id, 'summary', p_text), 'relay:' || v_message_id::text)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_handoff_id;
  IF v_handoff_id IS NULL THEN SELECT id INTO v_handoff_id FROM public.handoff_outbox WHERE idempotency_key = 'relay:' || v_message_id::text; END IF;
  UPDATE public.sessions SET status = 'escalated' WHERE id = p_session_id;
  RETURN QUERY SELECT true, false, v_message_id, v_handoff_id, v_session.telegram_thread_id::bigint;
END;
$$;

REVOKE ALL ON FUNCTION public.update_session_draft(uuid, integer, jsonb), public.finalize_session_lead(uuid), public.relay_human_message(uuid, text, text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.update_session_draft(uuid, integer, jsonb), public.finalize_session_lead(uuid), public.relay_human_message(uuid, text, text) TO service_role;
  END IF;
END $$;
