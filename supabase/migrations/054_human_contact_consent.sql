ALTER TABLE public.session_consents DROP CONSTRAINT session_consents_scope_check;
ALTER TABLE public.session_consents ADD CONSTRAINT session_consents_scope_check
  CHECK (scope IN ('analysis', 'human_contact', 'producer_transfer'));

DROP FUNCTION public.record_session_consent(uuid, text, boolean, text);
CREATE FUNCTION public.record_session_consent(p_session_id uuid, p_scope text, p_granted boolean, p_notice_version text)
RETURNS TABLE (analysis boolean, human_contact boolean, producer_transfer boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_session_id IS NULL OR p_scope NOT IN ('analysis', 'human_contact', 'producer_transfer') OR coalesce(trim(p_notice_version), '') = '' THEN RAISE EXCEPTION 'invalid consent transition' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.session_consents (session_id, scope, granted, notice_version, provenance) VALUES (p_session_id, p_scope, p_granted, p_notice_version, 'session_capability');
  RETURN QUERY SELECT
    coalesce((SELECT granted FROM public.session_consents WHERE session_id = p_session_id AND scope = 'analysis' ORDER BY created_at DESC, id DESC LIMIT 1), false),
    coalesce((SELECT granted FROM public.session_consents WHERE session_id = p_session_id AND scope = 'human_contact' ORDER BY created_at DESC, id DESC LIMIT 1), false),
    coalesce((SELECT granted FROM public.session_consents WHERE session_id = p_session_id AND scope = 'producer_transfer' ORDER BY created_at DESC, id DESC LIMIT 1), false);
END; $$;

CREATE OR REPLACE FUNCTION public.relay_human_message(p_session_id uuid, p_request_id text, p_text text)
RETURNS TABLE (persisted boolean, consent_required boolean, message_id bigint, handoff_id uuid, thread_id bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_session public.sessions%ROWTYPE; v_message_id bigint; v_handoff_id uuid; v_human_contact boolean;
BEGIN
  IF coalesce(btrim(p_request_id), '') = '' THEN RAISE EXCEPTION 'request id required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;
  SELECT coalesce(granted, false) INTO v_human_contact FROM public.session_consents WHERE session_id = p_session_id AND scope = 'human_contact' ORDER BY created_at DESC, id DESC LIMIT 1;
  IF NOT coalesce(v_human_contact, false) THEN RETURN QUERY SELECT false, true, null::bigint, null::uuid, v_session.telegram_thread_id::bigint; RETURN; END IF;
  INSERT INTO public.human_messages (session_id, sender, text, request_id, telegram_thread_id) VALUES (p_session_id, 'user', p_text, p_request_id, v_session.telegram_thread_id) ON CONFLICT (session_id, request_id) WHERE request_id IS NOT NULL DO NOTHING RETURNING id INTO v_message_id;
  IF v_message_id IS NULL THEN SELECT id INTO v_message_id FROM public.human_messages WHERE session_id = p_session_id AND request_id = p_request_id; END IF;
  INSERT INTO public.handoff_outbox (session_id, payload, idempotency_key) VALUES (p_session_id, jsonb_build_object('sessionId', p_session_id, 'type', 'relay', 'messageId', v_message_id, 'threadId', v_session.telegram_thread_id, 'summary', p_text), 'relay:' || v_message_id::text) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO v_handoff_id;
  IF v_handoff_id IS NULL THEN SELECT id INTO v_handoff_id FROM public.handoff_outbox WHERE idempotency_key = 'relay:' || v_message_id::text; END IF;
  UPDATE public.sessions SET status = 'escalated' WHERE id = p_session_id;
  RETURN QUERY SELECT true, false, v_message_id, v_handoff_id, v_session.telegram_thread_id::bigint;
END; $$;
REVOKE ALL ON FUNCTION public.record_session_consent(uuid, text, boolean, text), public.relay_human_message(uuid, text, text) FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.record_session_consent(uuid, text, boolean, text), public.relay_human_message(uuid, text, text) TO service_role; END IF; END $$;
