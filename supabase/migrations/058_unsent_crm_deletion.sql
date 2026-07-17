CREATE OR REPLACE FUNCTION public.queue_crm_lead_deletion(p_crm_lead_id uuid, p_audit_ref text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE lead_row public.crm_leads%ROWTYPE;
BEGIN
  SELECT * INTO lead_row FROM public.crm_leads WHERE id = p_crm_lead_id FOR UPDATE;
  IF NOT FOUND OR lead_row.lifecycle_state = 'deleted' THEN RETURN false; END IF;

  -- A locally queued projection can be removed without contacting Monday. Any
  -- provider-backed or ambiguous state retains the existing cleanup barrier.
  IF lead_row.monday_item_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.monday_sync_outbox
    WHERE crm_lead_id = lead_row.id
      AND operation = 'upsert'
      AND state IN ('sending', 'synced', 'delivery_unknown', 'conflict', 'failed')
  ) THEN
    DELETE FROM public.monday_sync_outbox WHERE crm_lead_id = lead_row.id;
    DELETE FROM public.crm_leads WHERE id = lead_row.id;
    RETURN true;
  END IF;

  UPDATE public.crm_leads SET lifecycle_state = 'deletion_requested', updated_at = now() WHERE id = lead_row.id;
  UPDATE public.monday_sync_outbox SET state = 'suppressed', claim_token = NULL, claim_expires_at = NULL, updated_at = now()
  WHERE crm_lead_id = lead_row.id AND operation = 'upsert' AND state IN ('pending', 'claiming');
  IF lead_row.desired_revision > 0 THEN
    INSERT INTO public.monday_sync_outbox (crm_lead_id, revision, operation)
    VALUES (lead_row.id, lead_row.desired_revision, 'delete')
    ON CONFLICT (crm_lead_id, revision, operation) DO NOTHING;
  END IF;
  INSERT INTO public.crm_lead_lifecycle_audit (crm_lead_id, action, audit_ref)
  VALUES (lead_row.id, 'deletion_requested', left(p_audit_ref, 200));
  RETURN true;
END;
$$;
