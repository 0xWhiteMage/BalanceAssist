-- Provider intent remains immutable after a send, except the deletion protocol
-- deliberately rolls a verified scrub into a separately idempotent delete intent.
CREATE OR REPLACE FUNCTION public.enforce_monday_sync_outbox_provider_intent()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE intent_changed boolean;
BEGIN
  intent_changed := NEW.provider_operation IS DISTINCT FROM OLD.provider_operation
    OR (NEW.target_item_id IS DISTINCT FROM OLD.target_item_id
      AND NOT (OLD.state = 'sending' AND NEW.state = 'synced' AND OLD.provider_operation = 'create'
        AND OLD.target_item_id IS NULL AND NEW.target_item_id IS NOT NULL))
    OR NEW.frozen_payload_hash IS DISTINCT FROM OLD.frozen_payload_hash
    OR NEW.item_name IS DISTINCT FROM OLD.item_name;
  IF NEW.request_key IS DISTINCT FROM OLD.request_key AND NOT intent_changed THEN
    RAISE EXCEPTION 'request key cannot change without changing provider intent';
  END IF;
  IF intent_changed THEN
    IF OLD.state IN ('delivery_unknown', 'synced')
      OR (OLD.state = 'sending' AND NOT (OLD.provider_operation = 'scrub' AND NEW.provider_operation = 'delete' AND NEW.state = 'claiming')) THEN
      RAISE EXCEPTION 'cannot change provider intent after delivery may have occurred';
    END IF;
    IF NEW.request_key = OLD.request_key THEN RAISE EXCEPTION 'changed provider intent requires a new request key'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Every transition touching an aggregate uses this order. The initial lookup
-- intentionally has no lock; the ordered locks are the ownership boundary.
CREATE OR REPLACE FUNCTION public.lock_monday_sync_aggregate(p_sync_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_lead_id uuid; v_session_id uuid;
BEGIN
  SELECT o.crm_lead_id INTO v_lead_id FROM public.monday_sync_outbox o WHERE o.id = p_sync_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT l.source_session_id INTO v_session_id FROM public.crm_leads l WHERE l.id = v_lead_id;
  IF v_session_id IS NOT NULL THEN
    PERFORM 1 FROM public.sessions s WHERE s.id = v_session_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN RETURN false; END IF;
  END IF;
  PERFORM 1 FROM public.crm_leads l WHERE l.id = v_lead_id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.monday_sync_outbox o WHERE o.id = p_sync_id FOR UPDATE SKIP LOCKED;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_next_monday_sync(p_lease_seconds integer DEFAULT 120, p_operations text[] DEFAULT ARRAY['upsert', 'delete']::text[])
RETURNS TABLE (id uuid, crm_lead_id uuid, revision integer, operation text, payload jsonb, provider_operation text, target_item_id text, item_name text, frozen_payload_hash text, request_key uuid, claim_token uuid, resolution text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE candidate public.monday_sync_outbox%ROWTYPE; sync_row public.monday_sync_outbox%ROWTYPE;
  lead_row public.crm_leads%ROWTYPE; session_id uuid; now_at timestamptz := now();
BEGIN
  IF p_lease_seconds NOT BETWEEN 30 AND 600 THEN RAISE EXCEPTION 'lease seconds out of range'; END IF;
  IF cardinality(p_operations) IS NULL OR cardinality(p_operations) = 0 OR EXISTS (SELECT 1 FROM unnest(p_operations) AS requested_operation WHERE requested_operation NOT IN ('upsert', 'delete')) THEN RAISE EXCEPTION 'invalid Monday operations'; END IF;
  LOOP
    -- Discovery holds no lock. Locks below always follow session, aggregate, outbox.
    SELECT o.* INTO candidate FROM public.monday_sync_outbox o
    WHERE ((o.state = 'pending' AND o.next_attempt_at <= now_at)
       OR o.state = 'delivery_unknown'
       OR (o.state IN ('claiming', 'sending') AND o.claim_expires_at <= now_at))
      AND o.operation = ANY(p_operations)
      AND NOT EXISTS (
        SELECT 1 FROM public.monday_sync_outbox unknown_sync
        WHERE unknown_sync.crm_lead_id = o.crm_lead_id AND unknown_sync.state = 'delivery_unknown' AND unknown_sync.id <> o.id
      )
      AND NOT (
        o.operation = 'delete' AND EXISTS (
          SELECT 1 FROM public.monday_sync_outbox earlier_upsert
          WHERE earlier_upsert.crm_lead_id = o.crm_lead_id AND earlier_upsert.operation = 'upsert'
            AND earlier_upsert.revision <= o.revision
            AND earlier_upsert.state IN ('claiming', 'sending', 'delivery_unknown')
        )
      )
    ORDER BY CASE WHEN o.state = 'delivery_unknown' THEN 0 WHEN o.operation = 'delete' THEN 1 ELSE 2 END,
      CASE WHEN o.state IN ('claiming', 'sending') THEN 0 ELSE 1 END, o.next_attempt_at, o.created_at
    LIMIT 1;
    IF NOT FOUND THEN RETURN; END IF;

    IF NOT public.lock_monday_sync_aggregate(candidate.id) THEN CONTINUE; END IF;
    SELECT * INTO lead_row FROM public.crm_leads l WHERE l.id = candidate.crm_lead_id;
    SELECT * INTO sync_row FROM public.monday_sync_outbox o WHERE o.id = candidate.id;

    IF sync_row.state = 'delivery_unknown' THEN
      UPDATE public.monday_sync_outbox o SET state = 'claiming', claim_token = gen_random_uuid(), claim_expires_at = now_at + make_interval(secs => p_lease_seconds), updated_at = now_at WHERE o.id = sync_row.id RETURNING * INTO sync_row;
      RETURN QUERY SELECT sync_row.id, sync_row.crm_lead_id, sync_row.revision, sync_row.operation,
        (SELECT r.payload FROM public.crm_lead_revisions r WHERE r.crm_lead_id = sync_row.crm_lead_id AND r.revision = sync_row.revision), sync_row.provider_operation, sync_row.target_item_id, sync_row.item_name, sync_row.frozen_payload_hash, sync_row.request_key, sync_row.claim_token, 'recovery'::text;
      RETURN;
    END IF;
    IF sync_row.state IN ('claiming', 'sending') AND sync_row.claim_expires_at <= now_at THEN
      IF sync_row.state = 'sending' AND sync_row.provider_operation = 'create' AND lead_row.monday_item_id IS NULL THEN
        UPDATE public.monday_sync_outbox o SET state = 'delivery_unknown', claim_expires_at = NULL, claim_token = NULL, last_error_code = 'monday_delivery_unknown', updated_at = now_at WHERE o.id = sync_row.id;
        CONTINUE;
      END IF;
      UPDATE public.monday_sync_outbox o SET state = 'pending', claim_expires_at = NULL, claim_token = NULL, updated_at = now_at WHERE o.id = sync_row.id;
      CONTINUE;
    END IF;
    IF sync_row.state <> 'pending' OR sync_row.next_attempt_at > now_at THEN CONTINUE; END IF;
    IF sync_row.operation = 'upsert' AND (lead_row.lifecycle_state <> 'active' OR sync_row.revision <> lead_row.desired_revision) THEN
      UPDATE public.monday_sync_outbox o SET state = 'suppressed', claim_expires_at = NULL, claim_token = NULL, updated_at = now_at WHERE o.id = sync_row.id;
      RETURN QUERY SELECT sync_row.id, sync_row.crm_lead_id, sync_row.revision, sync_row.operation, NULL::jsonb, NULL::text, NULL::text, NULL::text, NULL::text, sync_row.request_key, NULL::uuid, 'suppressed'::text;
      RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.monday_sync_outbox x WHERE x.crm_lead_id = sync_row.crm_lead_id AND x.state = 'delivery_unknown') THEN CONTINUE; END IF;
    IF sync_row.operation = 'delete' AND EXISTS (SELECT 1 FROM public.monday_sync_outbox x WHERE x.crm_lead_id = sync_row.crm_lead_id AND x.operation = 'upsert' AND x.revision <= sync_row.revision AND x.state IN ('claiming', 'sending', 'delivery_unknown')) THEN CONTINUE; END IF;

    UPDATE public.monday_sync_outbox o SET state = 'claiming', claim_token = gen_random_uuid(), claim_expires_at = now_at + make_interval(secs => p_lease_seconds), updated_at = now_at WHERE o.id = sync_row.id
    RETURNING * INTO sync_row;
    RETURN QUERY SELECT sync_row.id, sync_row.crm_lead_id, sync_row.revision, sync_row.operation,
      (SELECT r.payload FROM public.crm_lead_revisions r WHERE r.crm_lead_id = sync_row.crm_lead_id AND r.revision = sync_row.revision), sync_row.provider_operation, sync_row.target_item_id, sync_row.item_name, sync_row.frozen_payload_hash, sync_row.request_key, sync_row.claim_token, 'claimed'::text;
    RETURN;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_monday_sync_send(p_sync_id uuid, p_claim_token uuid)
RETURNS TABLE (provider_operation text, target_item_id text, item_name text, frozen_payload_hash text, request_key uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE sync_row public.monday_sync_outbox%ROWTYPE; lead_row public.crm_leads%ROWTYPE; latest_consent record; v_payload_hash text; v_revision_consent_version text; intended_operation text; target_id text;
BEGIN
  IF NOT public.lock_monday_sync_aggregate(p_sync_id) THEN RETURN; END IF;
  SELECT * INTO sync_row FROM public.monday_sync_outbox WHERE id = p_sync_id;
  IF NOT FOUND OR sync_row.state <> 'claiming' OR sync_row.claim_token <> p_claim_token OR sync_row.claim_expires_at <= now() THEN RETURN; END IF;
  SELECT * INTO lead_row FROM public.crm_leads WHERE id = sync_row.crm_lead_id;
  IF sync_row.operation = 'upsert' THEN
    IF lead_row.lifecycle_state <> 'active' OR sync_row.revision <> lead_row.desired_revision THEN
      UPDATE public.monday_sync_outbox SET state = 'suppressed', claim_token = NULL, claim_expires_at = NULL, updated_at = now() WHERE id = p_sync_id; RETURN;
    END IF;
    IF lead_row.source_session_id IS NOT NULL THEN
      SELECT r.consent_notice_version INTO v_revision_consent_version FROM public.crm_lead_revisions r WHERE r.crm_lead_id = sync_row.crm_lead_id AND r.revision = sync_row.revision;
      SELECT granted, notice_version INTO latest_consent FROM public.session_consents WHERE session_id = lead_row.source_session_id AND scope = 'producer_transfer' ORDER BY created_at DESC, id DESC LIMIT 1;
      IF latest_consent.granted IS DISTINCT FROM true OR latest_consent.notice_version IS DISTINCT FROM v_revision_consent_version THEN
        UPDATE public.monday_sync_outbox SET state = 'suppressed', claim_token = NULL, claim_expires_at = NULL, updated_at = now() WHERE id = p_sync_id; RETURN;
      END IF;
    END IF;
    SELECT r.payload_hash INTO v_payload_hash FROM public.crm_lead_revisions r WHERE r.crm_lead_id = sync_row.crm_lead_id AND r.revision = sync_row.revision;
    intended_operation := CASE WHEN lead_row.monday_item_id IS NULL THEN 'create' ELSE 'update' END;
    target_id := lead_row.monday_item_id;
    UPDATE public.monday_sync_outbox o SET state = 'sending', provider_operation = intended_operation, target_item_id = target_id,
      frozen_payload_hash = v_payload_hash, item_name = 'Balance Assist - ' || left(lead_row.id::text, 8),
      request_key = CASE WHEN o.provider_operation IS DISTINCT FROM intended_operation OR o.target_item_id IS DISTINCT FROM target_id OR o.frozen_payload_hash IS DISTINCT FROM v_payload_hash OR o.item_name IS DISTINCT FROM ('Balance Assist - ' || left(lead_row.id::text, 8)) THEN gen_random_uuid() ELSE o.request_key END,
      claim_expires_at = now() + interval '90 seconds', updated_at = now() WHERE o.id = p_sync_id;
  ELSE
    IF lead_row.monday_item_id IS NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.monday_sync_outbox prior_create
        WHERE prior_create.crm_lead_id = sync_row.crm_lead_id AND prior_create.operation = 'upsert'
          AND prior_create.provider_operation = 'create'
          AND prior_create.state IN ('sending', 'delivery_unknown', 'synced')
      ) THEN RETURN; END IF;
      DELETE FROM public.monday_sync_outbox WHERE crm_lead_id = sync_row.crm_lead_id;
      DELETE FROM public.crm_lead_revisions WHERE crm_lead_id = sync_row.crm_lead_id;
      UPDATE public.crm_leads SET lifecycle_state = 'deleted', desired_revision = applied_revision, updated_at = now() WHERE id = sync_row.crm_lead_id;
      RETURN;
    END IF;
    IF sync_row.provider_operation = 'delete' THEN
      UPDATE public.monday_sync_outbox SET state = 'sending', claim_expires_at = now() + interval '90 seconds', updated_at = now() WHERE id = p_sync_id;
      RETURN QUERY SELECT o.provider_operation, o.target_item_id, o.item_name, o.frozen_payload_hash, o.request_key FROM public.monday_sync_outbox o WHERE o.id = p_sync_id;
      RETURN;
    END IF;
    UPDATE public.monday_sync_outbox o SET state = 'sending', provider_operation = 'scrub', target_item_id = lead_row.monday_item_id,
      item_name = lead_row.id::text, frozen_payload_hash = NULL,
      request_key = CASE WHEN o.provider_operation IS DISTINCT FROM 'scrub' OR o.target_item_id IS DISTINCT FROM lead_row.monday_item_id OR o.item_name IS DISTINCT FROM lead_row.id::text THEN gen_random_uuid() ELSE o.request_key END,
      claim_expires_at = now() + interval '90 seconds', updated_at = now() WHERE o.id = p_sync_id;
  END IF;
  RETURN QUERY SELECT o.provider_operation, o.target_item_id, o.item_name, o.frozen_payload_hash, o.request_key FROM public.monday_sync_outbox o WHERE o.id = p_sync_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_monday_sync_upsert(p_sync_id uuid, p_claim_token uuid, p_item_id text, p_provider_request_id text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE sync_row public.monday_sync_outbox%ROWTYPE; lead_row public.crm_leads%ROWTYPE; latest_consent record; revision_consent_version text; queue_cleanup boolean := false;
BEGIN
  IF coalesce(length(trim(p_item_id)), 0) = 0 THEN RETURN false; END IF;
  IF NOT public.lock_monday_sync_aggregate(p_sync_id) THEN RETURN false; END IF;
  SELECT * INTO sync_row FROM public.monday_sync_outbox WHERE id = p_sync_id;
  IF NOT FOUND OR sync_row.state <> 'sending' OR sync_row.claim_token <> p_claim_token OR sync_row.operation <> 'upsert' THEN RETURN false; END IF;
  SELECT * INTO lead_row FROM public.crm_leads WHERE id = sync_row.crm_lead_id;
  IF lead_row.lifecycle_state <> 'active' THEN queue_cleanup := true; END IF;
  IF lead_row.source_session_id IS NOT NULL THEN
    SELECT r.consent_notice_version INTO revision_consent_version FROM public.crm_lead_revisions r WHERE r.crm_lead_id = sync_row.crm_lead_id AND r.revision = sync_row.revision;
    SELECT c.granted, c.notice_version INTO latest_consent FROM public.session_consents c WHERE c.session_id = lead_row.source_session_id AND c.scope = 'producer_transfer' ORDER BY c.created_at DESC, c.id DESC LIMIT 1;
    IF latest_consent.granted IS DISTINCT FROM true OR latest_consent.notice_version IS DISTINCT FROM revision_consent_version THEN queue_cleanup := true; END IF;
  END IF;
  UPDATE public.monday_sync_outbox SET state = 'synced', target_item_id = p_item_id, provider_request_id = CASE WHEN p_provider_request_id ~ '^[A-Za-z0-9._:-]{1,200}$' THEN p_provider_request_id ELSE NULL END, claim_token = NULL, claim_expires_at = NULL, updated_at = now() WHERE id = p_sync_id;
  UPDATE public.crm_leads SET monday_item_id = p_item_id, applied_revision = greatest(applied_revision, sync_row.revision), lifecycle_state = CASE WHEN queue_cleanup THEN 'deletion_requested' ELSE lifecycle_state END, updated_at = now() WHERE id = sync_row.crm_lead_id;
  IF queue_cleanup THEN
    INSERT INTO public.monday_sync_outbox (crm_lead_id, revision, operation) VALUES (sync_row.crm_lead_id, sync_row.revision, 'delete') ON CONFLICT (crm_lead_id, revision, operation) DO NOTHING;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_monday_sync_scrub(p_sync_id uuid, p_claim_token uuid, p_provider_request_id text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.lock_monday_sync_aggregate(p_sync_id) THEN RETURN false; END IF;
  UPDATE public.monday_sync_outbox SET state = 'claiming', provider_operation = 'delete', request_key = gen_random_uuid(), provider_request_id = CASE WHEN p_provider_request_id ~ '^[A-Za-z0-9._:-]{1,200}$' THEN p_provider_request_id ELSE NULL END, claim_expires_at = now() + interval '120 seconds', updated_at = now()
  WHERE id = p_sync_id AND operation = 'delete' AND state = 'sending' AND provider_operation = 'scrub' AND claim_token = p_claim_token;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_monday_sync_delete(p_sync_id uuid, p_claim_token uuid, p_provider_request_id text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE sync_row public.monday_sync_outbox%ROWTYPE;
BEGIN
  IF NOT public.lock_monday_sync_aggregate(p_sync_id) THEN RETURN false; END IF;
  SELECT * INTO sync_row FROM public.monday_sync_outbox WHERE id = p_sync_id;
  IF NOT FOUND OR sync_row.operation <> 'delete' OR sync_row.state <> 'sending' OR sync_row.provider_operation <> 'delete' OR sync_row.claim_token <> p_claim_token THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.monday_sync_outbox x WHERE x.crm_lead_id = sync_row.crm_lead_id AND x.operation = 'upsert' AND x.revision <= sync_row.revision AND x.state IN ('claiming', 'sending', 'delivery_unknown')) THEN RETURN false; END IF;
  DELETE FROM public.monday_sync_outbox WHERE crm_lead_id = sync_row.crm_lead_id;
  DELETE FROM public.crm_lead_revisions WHERE crm_lead_id = sync_row.crm_lead_id;
  UPDATE public.crm_leads SET lifecycle_state = 'deleted', monday_item_id = NULL, desired_revision = applied_revision, updated_at = now() WHERE id = sync_row.crm_lead_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_monday_sync_retry(p_sync_id uuid, p_claim_token uuid, p_code text, p_delay_seconds integer, p_provider_request_id text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_delay_seconds NOT BETWEEN 0 AND 86400 OR coalesce(length(trim(p_code)), 0) = 0 THEN RETURN false; END IF;
  IF NOT public.lock_monday_sync_aggregate(p_sync_id) THEN RETURN false; END IF;
  UPDATE public.monday_sync_outbox SET state = CASE WHEN provider_operation = 'create' THEN 'delivery_unknown' ELSE 'pending' END,
    attempts = attempts + 1, next_attempt_at = CASE WHEN provider_operation = 'create' THEN next_attempt_at ELSE now() + make_interval(secs => p_delay_seconds) END,
    last_error_code = left(CASE WHEN provider_operation = 'create' THEN 'monday_delivery_unknown' ELSE p_code END, 100), provider_request_id = CASE WHEN p_provider_request_id ~ '^[A-Za-z0-9._:-]{1,200}$' THEN p_provider_request_id ELSE NULL END, claim_token = NULL, claim_expires_at = NULL, updated_at = now()
  WHERE id = p_sync_id AND state = 'sending' AND claim_token = p_claim_token;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_monday_sync_unknown(p_sync_id uuid, p_claim_token uuid, p_code text, p_provider_request_id text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.lock_monday_sync_aggregate(p_sync_id) THEN RETURN false; END IF;
  UPDATE public.monday_sync_outbox SET state = 'delivery_unknown', last_error_code = left(coalesce(nullif(trim(p_code), ''), 'monday_delivery_unknown'), 100), provider_request_id = CASE WHEN p_provider_request_id ~ '^[A-Za-z0-9._:-]{1,200}$' THEN p_provider_request_id ELSE NULL END, claim_token = NULL, claim_expires_at = NULL, updated_at = now()
  WHERE id = p_sync_id AND state = 'sending' AND claim_token = p_claim_token;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_monday_sync_conflict(p_sync_id uuid, p_claim_token uuid, p_provider_request_id text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.lock_monday_sync_aggregate(p_sync_id) THEN RETURN false; END IF;
  UPDATE public.monday_sync_outbox SET state = 'conflict', provider_request_id = CASE WHEN p_provider_request_id ~ '^[A-Za-z0-9._:-]{1,200}$' THEN p_provider_request_id ELSE NULL END, claim_token = NULL, claim_expires_at = NULL, updated_at = now()
  WHERE id = p_sync_id AND state IN ('claiming', 'sending') AND claim_token = p_claim_token;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_monday_sync_aggregate(uuid), public.claim_next_monday_sync(integer, text[]), public.reserve_monday_sync_send(uuid, uuid), public.complete_monday_sync_upsert(uuid, uuid, text, text), public.complete_monday_sync_scrub(uuid, uuid, text), public.complete_monday_sync_delete(uuid, uuid, text), public.mark_monday_sync_retry(uuid, uuid, text, integer, text), public.mark_monday_sync_unknown(uuid, uuid, text, text), public.mark_monday_sync_conflict(uuid, uuid, text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION public.claim_next_monday_sync(integer, text[]), public.reserve_monday_sync_send(uuid, uuid), public.complete_monday_sync_upsert(uuid, uuid, text, text), public.complete_monday_sync_scrub(uuid, uuid, text), public.complete_monday_sync_delete(uuid, uuid, text), public.mark_monday_sync_retry(uuid, uuid, text, integer, text), public.mark_monday_sync_unknown(uuid, uuid, text, text), public.mark_monday_sync_conflict(uuid, uuid, text) FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION public.claim_next_monday_sync(integer, text[]), public.reserve_monday_sync_send(uuid, uuid), public.complete_monday_sync_upsert(uuid, uuid, text, text), public.complete_monday_sync_scrub(uuid, uuid, text), public.complete_monday_sync_delete(uuid, uuid, text), public.mark_monday_sync_retry(uuid, uuid, text, integer, text), public.mark_monday_sync_unknown(uuid, uuid, text, text), public.mark_monday_sync_conflict(uuid, uuid, text) FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.claim_next_monday_sync(integer, text[]), public.reserve_monday_sync_send(uuid, uuid), public.complete_monday_sync_upsert(uuid, uuid, text, text), public.complete_monday_sync_scrub(uuid, uuid, text), public.complete_monday_sync_delete(uuid, uuid, text), public.mark_monday_sync_retry(uuid, uuid, text, integer, text), public.mark_monday_sync_unknown(uuid, uuid, text, text), public.mark_monday_sync_conflict(uuid, uuid, text) TO service_role; END IF;
END $$;
