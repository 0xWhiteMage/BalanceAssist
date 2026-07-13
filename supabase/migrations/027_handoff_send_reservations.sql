-- Tokenless claims can belong to pre-026 workers. Release them before any new
-- worker claims rows; deployers must drain old dispatchers before enabling 027 code.
UPDATE public.handoff_outbox
SET state = 'pending', claim_expires_at = NULL, claim_token = NULL, updated_at = now()
WHERE state = 'claiming' AND claim_token IS NULL;

ALTER TABLE public.handoff_outbox
  DROP CONSTRAINT IF EXISTS handoff_outbox_state_check,
  ADD CONSTRAINT handoff_outbox_state_check
    CHECK (state IN ('pending', 'claiming', 'sending', 'sent', 'failed', 'escalated'));

DROP FUNCTION IF EXISTS public.claim_next_handoff();

CREATE FUNCTION public.claim_next_handoff()
RETURNS TABLE (
  id uuid,
  session_id uuid,
  payload jsonb,
  created_at timestamptz,
  claim_token uuid,
  resolution text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  handoff public.handoff_outbox%ROWTYPE;
  session_row public.sessions%ROWTYPE;
  producer_transfer_granted boolean;
  now_at timestamptz := now();
BEGIN
  LOOP
    SELECT * INTO handoff
    FROM public.handoff_outbox
    WHERE (state = 'pending' AND next_attempt_at <= now_at)
       OR (state IN ('claiming', 'sending') AND claim_expires_at <= now_at)
    ORDER BY CASE WHEN state IN ('claiming', 'sending') THEN 0 ELSE 1 END, next_attempt_at, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF NOT FOUND THEN RETURN; END IF;

    IF handoff.state IN ('claiming', 'sending') THEN
      UPDATE public.handoff_outbox
      SET state = 'pending', claim_expires_at = NULL, claim_token = NULL, updated_at = now_at
      WHERE id = handoff.id;
    END IF;

    SELECT * INTO session_row FROM public.sessions WHERE id = handoff.session_id FOR KEY SHARE;
    SELECT granted INTO producer_transfer_granted
    FROM public.session_consents
    WHERE session_id = handoff.session_id AND scope = 'producer_transfer'
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    IF session_row.id IS NULL OR session_row.draft_expires_at <= now_at OR producer_transfer_granted IS DISTINCT FROM true THEN
      UPDATE public.handoff_outbox
      SET state = 'failed', last_error = 'session_unavailable', claim_expires_at = NULL,
          claim_token = NULL, updated_at = now_at
      WHERE id = handoff.id;
      RETURN QUERY SELECT handoff.id, handoff.session_id, handoff.payload, handoff.created_at, NULL::uuid, 'suppressed'::text;
      RETURN;
    END IF;

    UPDATE public.handoff_outbox
    SET state = 'claiming', claimed_at = now_at, claim_token = gen_random_uuid(),
        claim_expires_at = now_at + interval '2 minutes', updated_at = now_at
    WHERE id = handoff.id;
    RETURN QUERY SELECT o.id, o.session_id, o.payload, o.created_at, o.claim_token, 'claimed'::text
    FROM public.handoff_outbox o WHERE o.id = handoff.id;
    RETURN;
  END LOOP;
END;
$$;

CREATE FUNCTION public.reserve_handoff_send(p_handoff_id uuid, p_claim_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 90 seconds exceeds Telegram's 45-second hard timeout by 45 seconds.
  UPDATE public.handoff_outbox
  SET state = 'sending', claim_expires_at = now() + interval '90 seconds', updated_at = now()
  WHERE id = p_handoff_id
    AND state = 'claiming'
    AND claim_token = p_claim_token
    AND claim_expires_at > now();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_expired_temporary_sessions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  deleted_count integer;
  deferred_count integer;
  released_count integer;
BEGIN
  PERFORM set_config('app.session_purge', 'on', true);
  UPDATE public.handoff_outbox
  SET state = 'pending', claim_expires_at = NULL, claim_token = NULL, updated_at = now()
  WHERE state IN ('claiming', 'sending') AND claim_expires_at <= now();
  GET DIAGNOSTICS released_count = ROW_COUNT;

  SELECT count(*) INTO deferred_count FROM public.sessions s
  WHERE s.draft_expires_at <= now()
    AND EXISTS (SELECT 1 FROM public.handoff_outbox o WHERE o.session_id = s.id AND o.state IN ('claiming', 'sending') AND o.claim_expires_at > now());

  DELETE FROM public.sessions s
  WHERE s.draft_expires_at <= now()
    AND NOT EXISTS (SELECT 1 FROM public.handoff_outbox o WHERE o.session_id = s.id AND o.state IN ('claiming', 'sending') AND o.claim_expires_at > now());
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN jsonb_build_object('deleted_sessions', deleted_count, 'deferred_sessions', deferred_count, 'released_claims', released_count);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_handoff() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_handoff_send(uuid, uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION public.claim_next_handoff() FROM anon; REVOKE ALL ON FUNCTION public.reserve_handoff_send(uuid, uuid) FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION public.claim_next_handoff() FROM authenticated; REVOKE ALL ON FUNCTION public.reserve_handoff_send(uuid, uuid) FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.claim_next_handoff() TO service_role; GRANT EXECUTE ON FUNCTION public.reserve_handoff_send(uuid, uuid) TO service_role; END IF;
END $$;
