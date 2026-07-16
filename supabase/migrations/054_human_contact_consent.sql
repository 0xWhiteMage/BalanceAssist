ALTER TABLE public.session_consents DROP CONSTRAINT session_consents_scope_check;
ALTER TABLE public.session_consents ADD CONSTRAINT session_consents_scope_check
  CHECK (scope IN ('analysis', 'human_contact', 'producer_transfer'));

DROP FUNCTION public.record_session_consent(uuid, text, boolean, text);
CREATE FUNCTION public.record_session_consent(p_session_id uuid, p_scope text, p_granted boolean, p_notice_version text)
RETURNS TABLE (analysis boolean, human_contact boolean, producer_transfer boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE lead_row public.crm_leads%ROWTYPE;
BEGIN
  IF p_session_id IS NULL OR p_scope NOT IN ('analysis', 'human_contact', 'producer_transfer') OR coalesce(trim(p_notice_version), '') = '' THEN RAISE EXCEPTION 'invalid consent transition' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.session_consents (session_id, scope, granted, notice_version, provenance) VALUES (p_session_id, p_scope, p_granted, p_notice_version, 'session_capability');
  IF p_scope = 'producer_transfer' AND NOT p_granted THEN
    FOR lead_row IN SELECT * FROM public.crm_leads WHERE source_session_id = p_session_id FOR UPDATE LOOP
      PERFORM public.queue_crm_lead_deletion(lead_row.id, 'system:producer-transfer-revoked');
    END LOOP;
  END IF;
  RETURN QUERY SELECT
    coalesce((SELECT granted FROM public.session_consents WHERE session_id = p_session_id AND scope = 'analysis' ORDER BY created_at DESC, id DESC LIMIT 1), false),
    coalesce((SELECT granted FROM public.session_consents WHERE session_id = p_session_id AND scope = 'human_contact' ORDER BY created_at DESC, id DESC LIMIT 1), false),
    coalesce((SELECT granted FROM public.session_consents WHERE session_id = p_session_id AND scope = 'producer_transfer' ORDER BY created_at DESC, id DESC LIMIT 1), false);
END; $$;

CREATE OR REPLACE FUNCTION public.claim_next_handoff()
RETURNS TABLE (id uuid, session_id uuid, payload jsonb, created_at timestamptz, claim_token uuid, resolution text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE handoff public.handoff_outbox%ROWTYPE; session_row public.sessions%ROWTYPE; consent_granted boolean; now_at timestamptz := now();
BEGIN
  LOOP
    SELECT o.* INTO handoff FROM public.handoff_outbox o
    WHERE (o.state = 'pending' AND o.next_attempt_at <= now_at) OR (o.state IN ('claiming', 'sending') AND o.claim_expires_at <= now_at)
    ORDER BY CASE WHEN o.state IN ('claiming', 'sending') THEN 0 ELSE 1 END, o.next_attempt_at, o.created_at
    FOR UPDATE SKIP LOCKED LIMIT 1;
    IF NOT FOUND THEN RETURN; END IF;
    IF handoff.state IN ('claiming', 'sending') THEN
      UPDATE public.handoff_outbox o SET state = 'pending', claim_expires_at = NULL, claim_token = NULL, updated_at = now_at WHERE o.id = handoff.id;
    END IF;
    SELECT s.* INTO session_row FROM public.sessions s WHERE s.id = handoff.session_id FOR KEY SHARE;
    SELECT c.granted INTO consent_granted FROM public.session_consents c
    WHERE c.session_id = handoff.session_id
      AND c.scope = CASE WHEN handoff.payload->>'type' = 'relay' THEN 'human_contact' ELSE 'producer_transfer' END
    ORDER BY c.created_at DESC, c.id DESC LIMIT 1;
    IF session_row.id IS NULL OR session_row.draft_expires_at <= now_at OR consent_granted IS DISTINCT FROM true THEN
      UPDATE public.handoff_outbox o SET state = 'failed', last_error = 'session_unavailable', claim_expires_at = NULL, claim_token = NULL, updated_at = now_at WHERE o.id = handoff.id;
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
DECLARE handoff public.handoff_outbox%ROWTYPE; consent_granted boolean;
BEGIN
  SELECT o.* INTO handoff FROM public.handoff_outbox o WHERE o.id = p_handoff_id;
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
REVOKE ALL ON FUNCTION public.record_session_consent(uuid, text, boolean, text), public.relay_human_message(uuid, text, text), public.claim_next_handoff(), public.reserve_handoff_send(uuid, uuid) FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.record_session_consent(uuid, text, boolean, text), public.relay_human_message(uuid, text, text), public.claim_next_handoff(), public.reserve_handoff_send(uuid, uuid) TO service_role; END IF; END $$;
