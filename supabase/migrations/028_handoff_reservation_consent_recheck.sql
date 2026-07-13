CREATE OR REPLACE FUNCTION public.reserve_handoff_send(p_handoff_id uuid, p_claim_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  producer_transfer_granted boolean;
BEGIN
  SELECT granted INTO producer_transfer_granted
  FROM public.session_consents c
  JOIN public.handoff_outbox o ON o.session_id = c.session_id
  WHERE o.id = p_handoff_id AND c.scope = 'producer_transfer'
  ORDER BY c.created_at DESC, c.id DESC
  LIMIT 1;

  IF producer_transfer_granted IS DISTINCT FROM true THEN
    UPDATE public.handoff_outbox
    SET state = 'failed', last_error = 'producer_transfer_revoked', claim_expires_at = NULL,
        claim_token = NULL, updated_at = now()
    WHERE id = p_handoff_id AND state = 'claiming' AND claim_token = p_claim_token;
    RETURN false;
  END IF;

  UPDATE public.handoff_outbox
  SET state = 'sending', claim_expires_at = now() + interval '90 seconds', updated_at = now()
  WHERE id = p_handoff_id AND state = 'claiming' AND claim_token = p_claim_token AND claim_expires_at > now();
  RETURN FOUND;
END;
$$;
