ALTER TABLE public.handoff_outbox
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS handoff_outbox_active_claim_session_idx
  ON public.handoff_outbox (session_id, claim_expires_at)
  WHERE state = 'claiming';

CREATE INDEX IF NOT EXISTS handoff_outbox_due_claim_idx
  ON public.handoff_outbox (state, next_attempt_at, created_at)
  WHERE state = 'pending';

CREATE OR REPLACE FUNCTION public.claim_next_handoff()
RETURNS TABLE (
  id uuid,
  session_id uuid,
  payload jsonb,
  created_at timestamptz,
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
       OR (state = 'claiming' AND claim_expires_at <= now_at)
    ORDER BY CASE WHEN state = 'claiming' THEN 0 ELSE 1 END, next_attempt_at, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF NOT FOUND THEN RETURN; END IF;

    -- An abandoned lease becomes eligible for a fresh claim-time decision.
    IF handoff.state = 'claiming' THEN
      UPDATE public.handoff_outbox
      SET state = 'pending', claim_expires_at = NULL, updated_at = now_at
      WHERE id = handoff.id;
    END IF;

    SELECT * INTO session_row
    FROM public.sessions
    WHERE id = handoff.session_id
    FOR KEY SHARE;

    SELECT granted INTO producer_transfer_granted
    FROM public.session_consents
    WHERE session_id = handoff.session_id AND scope = 'producer_transfer'
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    IF session_row.id IS NULL OR session_row.draft_expires_at <= now_at OR producer_transfer_granted IS DISTINCT FROM true THEN
      UPDATE public.handoff_outbox
      SET state = 'failed',
          last_error = 'session_unavailable',
          claim_expires_at = NULL,
          updated_at = now_at
      WHERE id = handoff.id;

      RETURN QUERY SELECT handoff.id, handoff.session_id, handoff.payload, handoff.created_at, 'suppressed'::text;
      RETURN;
    END IF;

    UPDATE public.handoff_outbox
    SET state = 'claiming',
        claimed_at = now_at,
        claim_expires_at = now_at + interval '1 minute',
        updated_at = now_at
    WHERE id = handoff.id;

    RETURN QUERY SELECT handoff.id, handoff.session_id, handoff.payload, handoff.created_at, 'claimed'::text;
    RETURN;
  END LOOP;
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

  -- Expired leases are no longer in-flight; the next claim resolves retry or suppression.
  UPDATE public.handoff_outbox
  SET state = 'pending', claim_expires_at = NULL, updated_at = now()
  WHERE state = 'claiming' AND claim_expires_at <= now();
  GET DIAGNOSTICS released_count = ROW_COUNT;

  SELECT count(*) INTO deferred_count
  FROM public.sessions s
  WHERE s.draft_expires_at <= now()
    AND EXISTS (
      SELECT 1 FROM public.handoff_outbox o
      WHERE o.session_id = s.id
        AND o.state = 'claiming'
        AND o.claim_expires_at > now()
    );

  DELETE FROM public.sessions s
  WHERE s.draft_expires_at <= now()
    AND NOT EXISTS (
      SELECT 1 FROM public.handoff_outbox o
      WHERE o.session_id = s.id
        AND o.state = 'claiming'
        AND o.claim_expires_at > now()
    );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted_sessions', deleted_count,
    'deferred_sessions', deferred_count,
    'released_claims', released_count
  );
END;
$$;

DROP FUNCTION IF EXISTS public.authorize_handoff_send(uuid);

REVOKE ALL ON FUNCTION public.claim_next_handoff() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION public.claim_next_handoff() FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION public.claim_next_handoff() FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.claim_next_handoff() TO service_role; END IF;
END $$;
