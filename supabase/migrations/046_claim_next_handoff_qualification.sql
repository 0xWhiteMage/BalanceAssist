-- Qualify every table column: RETURNS TABLE exposes `id` as a PL/pgSQL variable.
CREATE OR REPLACE FUNCTION public.claim_next_handoff()
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
    SELECT o.* INTO handoff
    FROM public.handoff_outbox o
    WHERE (o.state = 'pending' AND o.next_attempt_at <= now_at)
       OR (o.state IN ('claiming', 'sending') AND o.claim_expires_at <= now_at)
    ORDER BY CASE WHEN o.state IN ('claiming', 'sending') THEN 0 ELSE 1 END, o.next_attempt_at, o.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF NOT FOUND THEN RETURN; END IF;

    IF handoff.state IN ('claiming', 'sending') THEN
      UPDATE public.handoff_outbox o
      SET state = 'pending', claim_expires_at = NULL, claim_token = NULL, updated_at = now_at
      WHERE o.id = handoff.id;
    END IF;

    SELECT s.* INTO session_row FROM public.sessions s WHERE s.id = handoff.session_id FOR KEY SHARE;
    SELECT c.granted INTO producer_transfer_granted
    FROM public.session_consents c
    WHERE c.session_id = handoff.session_id AND c.scope = 'producer_transfer'
    ORDER BY c.created_at DESC, c.id DESC
    LIMIT 1;

    IF session_row.id IS NULL OR session_row.draft_expires_at <= now_at OR producer_transfer_granted IS DISTINCT FROM true THEN
      UPDATE public.handoff_outbox o
      SET state = 'failed', last_error = 'session_unavailable', claim_expires_at = NULL,
          claim_token = NULL, updated_at = now_at
      WHERE o.id = handoff.id;
      RETURN QUERY SELECT handoff.id, handoff.session_id, handoff.payload, handoff.created_at, NULL::uuid, 'suppressed'::text;
      RETURN;
    END IF;

    UPDATE public.handoff_outbox o
    SET state = 'claiming', claimed_at = now_at, claim_token = gen_random_uuid(),
        claim_expires_at = now_at + interval '2 minutes', updated_at = now_at
    WHERE o.id = handoff.id;
    RETURN QUERY SELECT o.id, o.session_id, o.payload, o.created_at, o.claim_token, 'claimed'::text
    FROM public.handoff_outbox o WHERE o.id = handoff.id;
    RETURN;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_handoff() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION public.claim_next_handoff() FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION public.claim_next_handoff() FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.claim_next_handoff() TO service_role; END IF;
END $$;
