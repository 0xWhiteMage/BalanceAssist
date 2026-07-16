BEGIN;
SELECT pg_advisory_xact_lock(90442053);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '043' AND filename = '043_deletion_state_batched_cleanup.sql') THEN
    RAISE EXCEPTION 'CRM migration baseline 043 is not recorded with its reviewed filename';
  END IF;
  IF to_regclass('public.sessions') IS NULL OR to_regclass('public.deletion_jobs') IS NULL OR to_regclass('public.scheduler_heartbeats') IS NULL THEN
    RAISE EXCEPTION 'CRM migration baseline schema signatures are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE version IN ('044', '047', '048', '049', '052', '053')) THEN
    RAISE EXCEPTION 'reviewed CRM migration range is not empty';
  END IF;
END $$;

-- BEGIN 044 044_monday_crm_projection_tables.sql
CREATE TABLE public.crm_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_session_id uuid UNIQUE REFERENCES public.sessions(id) ON DELETE SET NULL,
  lead_id bigint UNIQUE REFERENCES public.leads(id) ON DELETE SET NULL,
  desired_revision integer NOT NULL DEFAULT 0 CHECK (desired_revision >= 0),
  applied_revision integer NOT NULL DEFAULT 0 CHECK (applied_revision >= 0),
  lifecycle_state text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_state IN ('active', 'review_overdue', 'deletion_requested', 'deleted', 'expired')),
  monday_item_id text,
  review_due_at timestamptz NOT NULL,
  retention_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (applied_revision <= desired_revision)
);

CREATE TABLE public.crm_lead_revisions (
  crm_lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  source_draft_version integer NOT NULL CHECK (source_draft_version >= 0),
  approval_input_hash text NOT NULL CHECK (approval_input_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  approved_at timestamptz NOT NULL,
  consent_notice_version text NOT NULL,
  consent_recorded_at timestamptz NOT NULL,
  PRIMARY KEY (crm_lead_id, revision),
  UNIQUE (crm_lead_id, approval_input_hash)
);

CREATE TABLE public.monday_sync_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  operation text NOT NULL CHECK (operation IN ('upsert', 'delete')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN (
    'pending', 'claiming', 'sending', 'synced', 'delivery_unknown',
    'conflict', 'failed', 'suppressed'
  )),
  provider_operation text CHECK (provider_operation IN ('create', 'update', 'scrub', 'delete')),
  target_item_id text,
  frozen_payload_hash text CHECK (frozen_payload_hash IS NULL OR frozen_payload_hash ~ '^[0-9a-f]{64}$'),
  item_name text CHECK (item_name IS NULL OR length(item_name) BETWEEN 1 AND 255),
  request_key uuid NOT NULL DEFAULT gen_random_uuid(),
  claim_token uuid,
  claim_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  provider_request_id text CHECK (provider_request_id IS NULL OR length(provider_request_id) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (crm_lead_id, revision) REFERENCES public.crm_lead_revisions (crm_lead_id, revision) ON DELETE RESTRICT,
  UNIQUE (crm_lead_id, revision, operation)
);

CREATE INDEX crm_leads_lifecycle_retention_idx
  ON public.crm_leads (lifecycle_state, retention_expires_at)
  WHERE retention_expires_at IS NOT NULL;

CREATE INDEX crm_leads_monday_item_receipt_idx
  ON public.crm_leads (monday_item_id)
  WHERE monday_item_id IS NOT NULL;

CREATE INDEX monday_sync_outbox_due_idx
  ON public.monday_sync_outbox (next_attempt_at, created_at)
  WHERE state = 'pending';

CREATE INDEX monday_sync_outbox_lease_expiry_idx
  ON public.monday_sync_outbox (claim_expires_at)
  WHERE state IN ('claiming', 'sending');

CREATE INDEX monday_sync_outbox_item_receipt_idx
  ON public.monday_sync_outbox (target_item_id)
  WHERE target_item_id IS NOT NULL;

CREATE UNIQUE INDEX monday_sync_outbox_active_execution_idx
  ON public.monday_sync_outbox (crm_lead_id)
  WHERE state IN ('claiming', 'sending');

-- A provider intent is immutable once reserved. A changed intent needs a new
-- request key, while unknown or completed delivery can never be rewritten.
CREATE FUNCTION public.enforce_monday_sync_outbox_provider_intent()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE intent_changed boolean;
BEGIN
  intent_changed :=
    NEW.provider_operation IS DISTINCT FROM OLD.provider_operation OR
    NEW.target_item_id IS DISTINCT FROM OLD.target_item_id OR
    NEW.frozen_payload_hash IS DISTINCT FROM OLD.frozen_payload_hash OR
    NEW.item_name IS DISTINCT FROM OLD.item_name;

  IF NEW.request_key IS DISTINCT FROM OLD.request_key AND NOT intent_changed THEN
    RAISE EXCEPTION 'request key cannot change without changing provider intent';
  END IF;

  IF intent_changed THEN
    IF OLD.state IN ('sending', 'delivery_unknown', 'synced') THEN
      RAISE EXCEPTION 'cannot change provider intent after delivery may have occurred';
    END IF;
    IF NEW.request_key = OLD.request_key THEN
      RAISE EXCEPTION 'changed provider intent requires a new request key';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER monday_sync_outbox_provider_intent
  BEFORE UPDATE ON public.monday_sync_outbox
  FOR EACH ROW EXECUTE FUNCTION public.enforce_monday_sync_outbox_provider_intent();

CREATE FUNCTION public.enforce_monday_sync_outbox_frozen_payload()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE approved_payload_hash text;
BEGIN
  IF NEW.frozen_payload_hash IS NOT NULL THEN
    SELECT payload_hash INTO approved_payload_hash
    FROM public.crm_lead_revisions
    WHERE crm_lead_id = NEW.crm_lead_id AND revision = NEW.revision;
    IF NOT FOUND OR NEW.frozen_payload_hash IS DISTINCT FROM approved_payload_hash THEN
      RAISE EXCEPTION 'frozen payload hash must match the approved revision';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER monday_sync_outbox_frozen_payload
  BEFORE INSERT OR UPDATE OF crm_lead_id, revision, frozen_payload_hash ON public.monday_sync_outbox
  FOR EACH ROW EXECUTE FUNCTION public.enforce_monday_sync_outbox_frozen_payload();

CREATE FUNCTION public.reject_crm_lead_revision_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'approved revision ledger is immutable';
END;
$$;

CREATE TRIGGER crm_lead_revision_immutable
  BEFORE UPDATE ON public.crm_lead_revisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_crm_lead_revision_update();

ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_lead_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monday_sync_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.crm_leads, public.crm_lead_revisions, public.monday_sync_outbox FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_monday_sync_outbox_provider_intent() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_monday_sync_outbox_frozen_payload() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_crm_lead_revision_update() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.crm_leads, public.crm_lead_revisions, public.monday_sync_outbox FROM anon;
    REVOKE ALL ON FUNCTION public.enforce_monday_sync_outbox_provider_intent() FROM anon;
    REVOKE ALL ON FUNCTION public.enforce_monday_sync_outbox_frozen_payload() FROM anon;
    REVOKE ALL ON FUNCTION public.reject_crm_lead_revision_update() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.crm_leads, public.crm_lead_revisions, public.monday_sync_outbox FROM authenticated;
    REVOKE ALL ON FUNCTION public.enforce_monday_sync_outbox_provider_intent() FROM authenticated;
    REVOKE ALL ON FUNCTION public.enforce_monday_sync_outbox_frozen_payload() FROM authenticated;
    REVOKE ALL ON FUNCTION public.reject_crm_lead_revision_update() FROM authenticated;
  END IF;
END $$;

-- END 044 044_monday_crm_projection_tables.sql
INSERT INTO public.schema_migrations (version, filename) VALUES ('044', '044_monday_crm_projection_tables.sql');

-- BEGIN 047 047_atomic_crm_approval.sql
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

-- END 047 047_atomic_crm_approval.sql
INSERT INTO public.schema_migrations (version, filename) VALUES ('047', '047_atomic_crm_approval.sql');

-- BEGIN 048 048_monday_sync_state_machine.sql
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

-- END 048 048_monday_sync_state_machine.sql
INSERT INTO public.schema_migrations (version, filename) VALUES ('048', '048_monday_sync_state_machine.sql');

-- BEGIN 049 049_monday_crm_lifecycle.sql
-- Lifecycle actions retain only an opaque CRM ID, action, and operator case reference.
CREATE TABLE public.crm_lead_lifecycle_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('review_due', 'renewed', 'expired', 'deletion_requested')),
  audit_ref text NOT NULL CHECK (length(trim(audit_ref)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_lead_lifecycle_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.crm_lead_lifecycle_audit FROM PUBLIC;
ALTER TABLE public.crm_lead_lifecycle_audit DROP CONSTRAINT crm_lead_lifecycle_audit_crm_lead_id_fkey;
ALTER TABLE public.crm_lead_lifecycle_audit ADD CONSTRAINT crm_lead_lifecycle_audit_crm_lead_id_fkey
  FOREIGN KEY (crm_lead_id) REFERENCES public.crm_leads(id) ON DELETE CASCADE;

ALTER TABLE public.deletion_jobs ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS deletion_jobs_due_idx ON public.deletion_jobs (next_attempt_at, requested_at)
  WHERE state IN ('requested', 'failed');

CREATE OR REPLACE FUNCTION public.claim_next_monday_sync(p_lease_seconds integer)
RETURNS TABLE (id uuid, crm_lead_id uuid, revision integer, operation text, payload jsonb, provider_operation text, target_item_id text, item_name text, frozen_payload_hash text, request_key uuid, claim_token uuid, resolution text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM public.claim_next_monday_sync(p_lease_seconds, ARRAY['upsert', 'delete']::text[]);
$$;

UPDATE public.crm_leads c SET
  review_due_at = coalesce(c.review_due_at, c.created_at + interval '90 days'),
  retention_expires_at = CASE
    WHEN coalesce((SELECT r.payload->>'qualificationStatus' FROM public.crm_lead_revisions r WHERE r.crm_lead_id = c.id ORDER BY r.revision DESC LIMIT 1), '') IN ('needs_review', 'misfit', 'unqualified')
      THEN coalesce(c.retention_expires_at, (SELECT r.approved_at + interval '30 days' FROM public.crm_lead_revisions r WHERE r.crm_lead_id = c.id ORDER BY r.revision DESC LIMIT 1))
    ELSE c.retention_expires_at
  END
WHERE c.lifecycle_state NOT IN ('deleted', 'expired');

-- A revision remains until no provider retry or operator resolution can need its
-- PII payload. Terminal receipts and suppressed work are safe to discard.
CREATE OR REPLACE FUNCTION public.prune_superseded_crm_lead_revisions(p_crm_lead_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE deleted_count integer;
BEGIN
  PERFORM 1 FROM public.crm_leads WHERE id = p_crm_lead_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  WITH safe_revisions AS (
    SELECT r.revision FROM public.crm_lead_revisions r
    JOIN public.crm_leads l ON l.id = r.crm_lead_id
    WHERE r.crm_lead_id = p_crm_lead_id AND r.revision < l.desired_revision
      AND NOT EXISTS (
        SELECT 1 FROM public.monday_sync_outbox o
        WHERE o.crm_lead_id = r.crm_lead_id AND o.revision = r.revision
          AND o.state IN ('pending', 'claiming', 'sending', 'delivery_unknown', 'conflict', 'failed')
      )
  ), removed_outbox AS (
    DELETE FROM public.monday_sync_outbox o USING safe_revisions s
    WHERE o.crm_lead_id = p_crm_lead_id AND o.revision = s.revision
  )
  DELETE FROM public.crm_lead_revisions r USING safe_revisions s
  WHERE r.crm_lead_id = p_crm_lead_id AND r.revision = s.revision;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.prune_crm_lead_revisions_after_safe_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'crm_leads' THEN
    PERFORM public.prune_superseded_crm_lead_revisions(NEW.id);
  ELSE
    PERFORM public.prune_superseded_crm_lead_revisions(NEW.crm_lead_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER crm_lead_prune_superseded
AFTER UPDATE OF desired_revision ON public.crm_leads
FOR EACH ROW WHEN (NEW.desired_revision > OLD.desired_revision)
EXECUTE FUNCTION public.prune_crm_lead_revisions_after_safe_transition();

CREATE TRIGGER monday_sync_outbox_prune_superseded
AFTER UPDATE OF state ON public.monday_sync_outbox
FOR EACH ROW WHEN (NEW.state IN ('synced', 'suppressed'))
EXECUTE FUNCTION public.prune_crm_lead_revisions_after_safe_transition();

CREATE OR REPLACE FUNCTION public.queue_crm_lead_deletion(p_crm_lead_id uuid, p_audit_ref text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE lead_row public.crm_leads%ROWTYPE;
BEGIN
  SELECT * INTO lead_row FROM public.crm_leads WHERE id = p_crm_lead_id FOR UPDATE;
  IF NOT FOUND OR lead_row.lifecycle_state = 'deleted' THEN RETURN false; END IF;
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

CREATE OR REPLACE FUNCTION public.record_session_consent(p_session_id uuid, p_scope text, p_granted boolean, p_notice_version text)
RETURNS TABLE (analysis boolean, producer_transfer boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE lead_row public.crm_leads%ROWTYPE;
BEGIN
  IF p_session_id IS NULL OR p_scope NOT IN ('analysis', 'producer_transfer') OR coalesce(trim(p_notice_version), '') = '' THEN
    RAISE EXCEPTION 'invalid consent transition' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.session_consents (session_id, scope, granted, notice_version, provenance)
  VALUES (p_session_id, p_scope, p_granted, p_notice_version, 'session_capability');
  IF p_scope = 'producer_transfer' AND NOT p_granted THEN
    FOR lead_row IN SELECT * FROM public.crm_leads WHERE source_session_id = p_session_id FOR UPDATE LOOP
      PERFORM public.queue_crm_lead_deletion(lead_row.id, 'system:producer-transfer-revoked');
    END LOOP;
  END IF;
  RETURN QUERY SELECT
    coalesce((SELECT granted FROM public.session_consents WHERE session_id = p_session_id AND scope = 'analysis' ORDER BY created_at DESC, id DESC LIMIT 1), false),
    coalesce((SELECT granted FROM public.session_consents WHERE session_id = p_session_id AND scope = 'producer_transfer' ORDER BY created_at DESC, id DESC LIMIT 1), false);
END;
$$;

CREATE OR REPLACE FUNCTION public.request_deletion_job(p_session_id uuid)
RETURNS public.deletion_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE job public.deletion_jobs%ROWTYPE; lead_row public.crm_leads%ROWTYPE; owner uuid;
BEGIN
  SELECT cleanup_owner_id INTO owner FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.sessions SET deletion_state = 'requested' WHERE id = p_session_id;
  FOR lead_row IN SELECT * FROM public.crm_leads WHERE source_session_id = p_session_id FOR UPDATE LOOP
    PERFORM public.queue_crm_lead_deletion(lead_row.id, 'system:session-deletion-requested');
  END LOOP;
  INSERT INTO public.deletion_jobs (session_id, cleanup_owner_id, next_attempt_at)
  VALUES (p_session_id, owner, now())
  ON CONFLICT (session_id) WHERE session_id IS NOT NULL DO UPDATE SET cleanup_owner_id = EXCLUDED.cleanup_owner_id, next_attempt_at = now(), updated_at = now()
  RETURNING * INTO job;
  RETURN job;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_deletion_job(p_lease_seconds integer DEFAULT 300)
RETURNS public.deletion_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE job public.deletion_jobs%ROWTYPE;
BEGIN
  IF p_lease_seconds NOT BETWEEN 30 AND 600 THEN RAISE EXCEPTION 'lease seconds out of range'; END IF;
  SELECT * INTO job FROM public.deletion_jobs
  WHERE (state IN ('requested', 'failed') AND next_attempt_at <= now())
    OR (state IN ('claimed', 'processing') AND lease_expires_at <= now())
  ORDER BY next_attempt_at, requested_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF job.cleanup_owner_id IS NULL AND job.session_id IS NOT NULL THEN
    UPDATE public.deletion_jobs j SET cleanup_owner_id = s.cleanup_owner_id FROM public.sessions s
    WHERE j.id = job.id AND s.id = job.session_id RETURNING j.* INTO job;
  END IF;
  UPDATE public.deletion_jobs SET state = 'claimed', attempts = job.attempts + 1, lease_token = gen_random_uuid(),
    lease_expires_at = now() + make_interval(secs => p_lease_seconds), claimed_at = now(), updated_at = now()
  WHERE id = job.id RETURNING * INTO job;
  RETURN job;
END;
$$;

CREATE OR REPLACE FUNCTION public.defer_deletion_job(p_job_id uuid, p_lease_token uuid, p_next_attempt_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_next_attempt_at IS NULL OR p_next_attempt_at <= now() OR p_next_attempt_at > now() + interval '24 hours' THEN RETURN false; END IF;
  UPDATE public.deletion_jobs SET state = 'requested', next_attempt_at = p_next_attempt_at, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE id = p_job_id AND state IN ('claimed', 'processing') AND lease_token = p_lease_token;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_session_for_deletion_job(p_job_id uuid, p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target_session_id uuid; owner uuid;
BEGIN
  SELECT session_id, cleanup_owner_id INTO target_session_id, owner FROM public.deletion_jobs
  WHERE id = p_job_id AND state = 'processing' AND lease_token = p_lease_token AND lease_expires_at > now() FOR UPDATE;
  IF target_session_id IS NULL THEN RETURN false; END IF;
  PERFORM 1 FROM public.sessions WHERE id = target_session_id AND deletion_state = 'deleting' FOR UPDATE;
  IF NOT FOUND OR EXISTS (SELECT 1 FROM public.uploaded_files WHERE session_id = target_session_id AND object_key IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.private_attachment_cleanup WHERE cleanup_owner_id = owner AND status = 'pending_cleanup')
    OR EXISTS (SELECT 1 FROM public.crm_leads WHERE source_session_id = target_session_id AND lifecycle_state <> 'deleted') THEN RETURN false; END IF;
  DELETE FROM public.sessions WHERE id = target_session_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_expired_crm_leads(p_limit integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE lead_row public.crm_leads%ROWTYPE; queued integer := 0; qualification text;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'invalid lifecycle limit'; END IF;
  FOR lead_row IN SELECT * FROM public.crm_leads
    WHERE lifecycle_state IN ('active', 'review_overdue')
      AND (retention_expires_at <= now() OR review_due_at <= now())
    ORDER BY least(coalesce(retention_expires_at, review_due_at), review_due_at), id FOR UPDATE SKIP LOCKED LIMIT p_limit
  LOOP
    SELECT payload->>'qualificationStatus' INTO qualification FROM public.crm_lead_revisions
    WHERE crm_lead_id = lead_row.id ORDER BY revision DESC LIMIT 1;
    IF qualification IN ('needs_review', 'misfit', 'unqualified') AND lead_row.retention_expires_at <= now() THEN
      PERFORM public.queue_crm_lead_deletion(lead_row.id, 'system:terminal-retention-expired'); queued := queued + 1;
    ELSIF qualification = 'qualified' AND lead_row.lifecycle_state = 'active' AND lead_row.review_due_at <= now() THEN
      UPDATE public.crm_leads SET lifecycle_state = 'review_overdue', updated_at = now() WHERE id = lead_row.id;
      INSERT INTO public.crm_lead_lifecycle_audit (crm_lead_id, action, audit_ref) VALUES (lead_row.id, 'review_due', 'system:review-due'); queued := queued + 1;
    ELSIF qualification = 'qualified' AND lead_row.lifecycle_state = 'review_overdue' AND lead_row.review_due_at + interval '30 days' <= now() THEN
      PERFORM public.queue_crm_lead_deletion(lead_row.id, 'system:review-grace-expired'); queued := queued + 1;
    END IF;
  END LOOP;
  RETURN queued;
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_crm_lead_review(p_crm_record_id uuid, p_audit_ref text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_crm_record_id IS NULL OR coalesce(trim(p_audit_ref), '') = '' THEN RETURN false; END IF;
  UPDATE public.crm_leads SET lifecycle_state = 'active', review_due_at = now() + interval '90 days', retention_expires_at = NULL, updated_at = now()
  WHERE id = p_crm_record_id AND lifecycle_state IN ('active', 'review_overdue');
  IF FOUND THEN INSERT INTO public.crm_lead_lifecycle_audit (crm_lead_id, action, audit_ref) VALUES (p_crm_record_id, 'renewed', left(trim(p_audit_ref), 200)); END IF;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_crm_lead(p_crm_record_id uuid, p_audit_ref text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_crm_record_id IS NULL OR coalesce(trim(p_audit_ref), '') = '' THEN RETURN false; END IF;
  IF NOT public.queue_crm_lead_deletion(p_crm_record_id, left(trim(p_audit_ref), 200)) THEN RETURN false; END IF;
  INSERT INTO public.crm_lead_lifecycle_audit (crm_lead_id, action, audit_ref) VALUES (p_crm_record_id, 'expired', left(trim(p_audit_ref), 200));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_crm_deletion_by_record_id(p_crm_record_id uuid, p_audit_ref text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_crm_record_id IS NULL OR coalesce(trim(p_audit_ref), '') = '' THEN RETURN false; END IF;
  RETURN public.queue_crm_lead_deletion(p_crm_record_id, left(trim(p_audit_ref), 200));
END;
$$;

REVOKE ALL ON FUNCTION public.prune_superseded_crm_lead_revisions(uuid), public.prune_crm_lead_revisions_after_safe_transition(), public.queue_crm_lead_deletion(uuid, text), public.record_session_consent(uuid, text, boolean, text), public.request_deletion_job(uuid), public.claim_deletion_job(integer), public.defer_deletion_job(uuid, uuid, timestamptz), public.delete_session_for_deletion_job(uuid, uuid), public.queue_expired_crm_leads(integer), public.renew_crm_lead_review(uuid, text), public.expire_crm_lead(uuid, text), public.request_crm_deletion_by_record_id(uuid, text), public.claim_next_monday_sync(integer) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION public.prune_superseded_crm_lead_revisions(uuid), public.record_session_consent(uuid, text, boolean, text), public.request_deletion_job(uuid), public.claim_deletion_job(integer), public.defer_deletion_job(uuid, uuid, timestamptz), public.delete_session_for_deletion_job(uuid, uuid), public.queue_expired_crm_leads(integer), public.renew_crm_lead_review(uuid, text), public.expire_crm_lead(uuid, text), public.request_crm_deletion_by_record_id(uuid, text), public.claim_next_monday_sync(integer) FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION public.prune_superseded_crm_lead_revisions(uuid), public.record_session_consent(uuid, text, boolean, text), public.request_deletion_job(uuid), public.claim_deletion_job(integer), public.defer_deletion_job(uuid, uuid, timestamptz), public.delete_session_for_deletion_job(uuid, uuid), public.queue_expired_crm_leads(integer), public.renew_crm_lead_review(uuid, text), public.expire_crm_lead(uuid, text), public.request_crm_deletion_by_record_id(uuid, text), public.claim_next_monday_sync(integer) FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.prune_superseded_crm_lead_revisions(uuid), public.record_session_consent(uuid, text, boolean, text), public.request_deletion_job(uuid), public.claim_deletion_job(integer), public.defer_deletion_job(uuid, uuid, timestamptz), public.delete_session_for_deletion_job(uuid, uuid), public.queue_expired_crm_leads(integer), public.renew_crm_lead_review(uuid, text), public.expire_crm_lead(uuid, text), public.request_crm_deletion_by_record_id(uuid, text), public.claim_next_monday_sync(integer) TO service_role; END IF;
END $$;

-- END 049 049_monday_crm_lifecycle.sql
INSERT INTO public.schema_migrations (version, filename) VALUES ('049', '049_monday_crm_lifecycle.sql');

-- BEGIN 052 052_monday_scheduler_health.sql
ALTER TABLE public.scheduler_heartbeats DROP CONSTRAINT scheduler_heartbeats_worker_check;
ALTER TABLE public.scheduler_heartbeats ADD CONSTRAINT scheduler_heartbeats_worker_check
  CHECK (worker IN ('handoff-dispatch', 'session-expiry', 'deletion-worker', 'monday-dispatch', 'monday-lifecycle'));

CREATE OR REPLACE FUNCTION public.record_scheduler_heartbeat(p_worker text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_worker NOT IN ('handoff-dispatch', 'session-expiry', 'deletion-worker', 'monday-dispatch', 'monday-lifecycle') THEN
    RAISE EXCEPTION 'unknown scheduler worker' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.scheduler_heartbeats (worker, last_seen_at) VALUES (p_worker, now())
  ON CONFLICT (worker) DO UPDATE SET last_seen_at = excluded.last_seen_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.scheduler_health(
  p_monday_dispatch_enabled boolean DEFAULT false,
  p_monday_lifecycle_enabled boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH required_workers AS (
    SELECT worker, freshness FROM (VALUES
      ('handoff-dispatch'::text, interval '20 minutes'),
      ('session-expiry'::text, interval '20 minutes'),
      ('deletion-worker'::text, interval '20 minutes')
    ) AS base(worker, freshness)
    UNION ALL SELECT 'monday-dispatch', interval '20 minutes' WHERE p_monday_dispatch_enabled
    UNION ALL SELECT 'monday-lifecycle', interval '26 hours' WHERE p_monday_lifecycle_enabled
  ), stale AS (
    SELECT required_workers.worker FROM required_workers
    LEFT JOIN public.scheduler_heartbeats heartbeat USING (worker)
    WHERE heartbeat.last_seen_at IS NULL OR heartbeat.last_seen_at < now() - required_workers.freshness
  ), outbox AS (
    SELECT floor(extract(epoch FROM now() - min(created_at)))::integer AS age
    FROM public.handoff_outbox WHERE state = 'pending'
  ), expiry AS (
    SELECT count(*)::integer AS backlog FROM public.sessions WHERE draft_expires_at <= now()
  ), deletions AS (
    SELECT floor(extract(epoch FROM now() - min(requested_at)))::integer AS age,
      count(*)::integer AS backlog
    FROM public.deletion_jobs WHERE state <> 'completed'
  ), monday AS (
    SELECT
      floor(extract(epoch FROM now() - min(created_at) FILTER (WHERE operation = 'upsert' AND state IN ('pending', 'claiming', 'sending'))) )::integer AS oldest_pending,
      count(*) FILTER (WHERE state = 'delivery_unknown')::integer AS delivery_unknown_count,
      count(*) FILTER (WHERE state = 'conflict')::integer AS conflict_count,
      count(*) FILTER (WHERE state = 'failed')::integer AS failed_count,
      count(*) FILTER (WHERE state IN ('claiming', 'sending') AND claim_expires_at <= now())::integer AS expired_lease_count,
      count(*) FILTER (WHERE last_error_code = 'monday_schema_drift')::integer AS schema_incident_count,
      count(*) FILTER (WHERE last_error_code IN ('monday_auth_failed', 'monday_permission_denied'))::integer AS permission_incident_count,
      count(*) FILTER (WHERE last_error_code = 'monday_rate_limited')::integer AS rate_limited_count,
      floor(extract(epoch FROM now() - min(created_at) FILTER (WHERE operation = 'delete' AND state IN ('pending', 'claiming', 'sending', 'delivery_unknown'))) )::integer AS oldest_pending_deletion
    FROM public.monday_sync_outbox
  ), reviews AS (
    SELECT count(*)::integer AS overdue_count,
      floor(extract(epoch FROM now() - min(review_due_at)))::integer AS oldest_overdue
    FROM public.crm_leads WHERE lifecycle_state = 'review_overdue'
  )
  SELECT jsonb_build_object(
    'healthy', NOT EXISTS (SELECT 1 FROM stale)
      AND coalesce((SELECT age FROM outbox), 0) <= 900
      AND (SELECT backlog FROM expiry) = 0
      AND coalesce((SELECT age FROM deletions), 0) <= 86400
      AND (NOT p_monday_dispatch_enabled OR (
        coalesce((SELECT oldest_pending FROM monday), 0) <= 900
        AND (SELECT delivery_unknown_count FROM monday) = 0
        AND (SELECT conflict_count FROM monday) = 0
        AND (SELECT failed_count FROM monday) = 0
        AND (SELECT expired_lease_count FROM monday) = 0
        AND (SELECT schema_incident_count FROM monday) = 0
        AND (SELECT permission_incident_count FROM monday) = 0
      ))
      AND (NOT p_monday_lifecycle_enabled OR coalesce((SELECT oldest_overdue FROM reviews), 0) <= 86400),
    'stale_workers', coalesce((SELECT jsonb_agg(worker ORDER BY worker) FROM stale), '[]'::jsonb),
    'oldest_pending_outbox_seconds', (SELECT age FROM outbox),
    'expired_session_backlog', (SELECT backlog FROM expiry),
    'oldest_pending_deletion_seconds', (SELECT age FROM deletions),
    'pending_deletion_count', (SELECT backlog FROM deletions),
    'oldest_pending_monday_seconds', (SELECT oldest_pending FROM monday),
    'monday_delivery_unknown_count', (SELECT delivery_unknown_count FROM monday),
    'monday_conflict_count', (SELECT conflict_count FROM monday),
    'monday_failed_count', (SELECT failed_count FROM monday),
    'monday_expired_lease_count', (SELECT expired_lease_count FROM monday),
    'monday_schema_incident_count', (SELECT schema_incident_count FROM monday),
    'monday_permission_incident_count', (SELECT permission_incident_count FROM monday),
    'monday_rate_limited_count', (SELECT rate_limited_count FROM monday),
    'oldest_pending_monday_deletion_seconds', (SELECT oldest_pending_deletion FROM monday),
    'overdue_crm_review_count', (SELECT overdue_count FROM reviews),
    'oldest_overdue_crm_review_seconds', (SELECT oldest_overdue FROM reviews)
  );
$$;

REVOKE ALL ON FUNCTION public.record_scheduler_heartbeat(text), public.scheduler_health(boolean, boolean) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.record_scheduler_heartbeat(text), public.scheduler_health(boolean, boolean) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.record_scheduler_heartbeat(text), public.scheduler_health(boolean, boolean) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.record_scheduler_heartbeat(text), public.scheduler_health(boolean, boolean) TO service_role;
  END IF;
END $$;

-- END 052 052_monday_scheduler_health.sql
INSERT INTO public.schema_migrations (version, filename) VALUES ('052', '052_monday_scheduler_health.sql');

-- BEGIN 053 053_monday_reconciliation.sql
CREATE TABLE public.monday_reconciliation_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cursor text,
  scan_started_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.monday_reconciliation_seen (
  checkpoint_id uuid NOT NULL REFERENCES public.monday_reconciliation_checkpoints(id) ON DELETE CASCADE,
  crm_lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  PRIMARY KEY (checkpoint_id, crm_lead_id)
);

ALTER TABLE public.monday_reconciliation_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monday_reconciliation_seen ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.monday_reconciliation_checkpoints, public.monday_reconciliation_seen FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.claim_monday_reconciliation_page()
RETURNS TABLE (id uuid, cursor text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE checkpoint public.monday_reconciliation_checkpoints%ROWTYPE;
BEGIN
  SELECT * INTO checkpoint FROM public.monday_reconciliation_checkpoints
  WHERE completed_at IS NULL AND (lease_expires_at IS NULL OR lease_expires_at <= now())
  ORDER BY scan_started_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    INSERT INTO public.monday_reconciliation_checkpoints (lease_expires_at)
    VALUES (now() + interval '2 minutes') RETURNING * INTO checkpoint;
  ELSE
    UPDATE public.monday_reconciliation_checkpoints SET lease_expires_at = now() + interval '2 minutes', updated_at = now()
    WHERE monday_reconciliation_checkpoints.id = checkpoint.id RETURNING * INTO checkpoint;
  END IF;
  RETURN QUERY SELECT checkpoint.id, checkpoint.cursor;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_monday_reconciled_item(p_checkpoint_id uuid, p_item_id text, p_crm_record_id text, p_active boolean, p_source_drift boolean)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE lead_row public.crm_leads%ROWTYPE; duplicate_seen boolean := false;
BEGIN
  IF coalesce(length(trim(p_item_id)), 0) = 0 OR coalesce(length(trim(p_crm_record_id)), 0) = 0 THEN RETURN 'ignored'; END IF;
  PERFORM 1 FROM public.monday_reconciliation_checkpoints WHERE id = p_checkpoint_id AND completed_at IS NULL AND lease_expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN RETURN 'stale'; END IF;
  SELECT * INTO lead_row FROM public.crm_leads WHERE id::text = p_crm_record_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'ignored'; END IF;
  BEGIN
    INSERT INTO public.monday_reconciliation_seen (checkpoint_id, crm_lead_id) VALUES (p_checkpoint_id, lead_row.id);
  EXCEPTION WHEN unique_violation THEN duplicate_seen := true;
  END;
  IF duplicate_seen OR (lead_row.monday_item_id IS NOT NULL AND lead_row.monday_item_id <> p_item_id) THEN
    UPDATE public.monday_sync_outbox SET state = 'conflict', claim_token = NULL, claim_expires_at = NULL, last_error_code = 'monday_duplicate_key_conflict', updated_at = now()
    WHERE crm_lead_id = lead_row.id AND state IN ('pending', 'claiming', 'sending', 'delivery_unknown');
    RETURN 'conflict';
  END IF;
  IF NOT p_active THEN
    UPDATE public.monday_sync_outbox SET state = 'pending', next_attempt_at = now(), claim_token = NULL, claim_expires_at = NULL, last_error_code = 'monday_item_inactive', updated_at = now()
    WHERE crm_lead_id = lead_row.id AND operation = 'upsert' AND state = 'synced';
    RETURN 'repair_enqueued';
  END IF;
  UPDATE public.crm_leads SET monday_item_id = p_item_id, applied_revision = greatest(applied_revision, desired_revision), updated_at = now() WHERE id = lead_row.id;
  UPDATE public.monday_sync_outbox SET state = CASE WHEN p_source_drift THEN 'pending' ELSE 'synced' END,
    claim_token = NULL, claim_expires_at = NULL, next_attempt_at = CASE WHEN p_source_drift THEN now() ELSE next_attempt_at END,
    last_error_code = CASE WHEN p_source_drift THEN 'monday_source_drift' ELSE NULL END, updated_at = now()
  WHERE crm_lead_id = lead_row.id AND operation = 'upsert' AND revision = lead_row.desired_revision AND state IN ('delivery_unknown', 'synced');
  RETURN CASE WHEN p_source_drift THEN 'repair_enqueued' ELSE 'adopted' END;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_monday_reconciliation_cursor(p_checkpoint_id uuid, p_cursor text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.monday_reconciliation_checkpoints SET cursor = p_cursor, lease_expires_at = NULL, updated_at = now()
  WHERE id = p_checkpoint_id AND completed_at IS NULL AND lease_expires_at > now();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_monday_reconciliation(p_checkpoint_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE repaired integer;
BEGIN
  PERFORM 1 FROM public.monday_reconciliation_checkpoints WHERE id = p_checkpoint_id AND completed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  WITH repaired_rows AS (
    UPDATE public.monday_sync_outbox o SET state = 'pending', next_attempt_at = now(), last_error_code = 'monday_item_missing', updated_at = now()
    FROM public.crm_leads l
    WHERE o.crm_lead_id = l.id AND o.operation = 'upsert' AND o.revision = l.desired_revision AND o.state = 'synced'
      AND l.monday_item_id IS NOT NULL AND l.updated_at < (SELECT scan_started_at - interval '5 minutes' FROM public.monday_reconciliation_checkpoints WHERE id = p_checkpoint_id)
      AND NOT EXISTS (SELECT 1 FROM public.monday_reconciliation_seen seen WHERE seen.checkpoint_id = p_checkpoint_id AND seen.crm_lead_id = l.id)
    RETURNING o.id
  ) SELECT count(*) INTO repaired FROM repaired_rows;
  UPDATE public.monday_reconciliation_checkpoints SET completed_at = now(), lease_expires_at = NULL, updated_at = now() WHERE id = p_checkpoint_id;
  RETURN jsonb_build_object('repairs', repaired);
END;
$$;

ALTER TABLE public.scheduler_heartbeats DROP CONSTRAINT scheduler_heartbeats_worker_check;
ALTER TABLE public.scheduler_heartbeats ADD CONSTRAINT scheduler_heartbeats_worker_check CHECK (worker IN ('handoff-dispatch', 'session-expiry', 'deletion-worker', 'monday-dispatch', 'monday-lifecycle', 'monday-reconcile'));

CREATE OR REPLACE FUNCTION public.record_scheduler_heartbeat(p_worker text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_worker NOT IN ('handoff-dispatch', 'session-expiry', 'deletion-worker', 'monday-dispatch', 'monday-lifecycle', 'monday-reconcile') THEN RAISE EXCEPTION 'unknown scheduler worker' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.scheduler_heartbeats (worker, last_seen_at) VALUES (p_worker, now()) ON CONFLICT (worker) DO UPDATE SET last_seen_at = excluded.last_seen_at;
END;
$$;

DROP FUNCTION public.scheduler_health(boolean, boolean);
CREATE FUNCTION public.scheduler_health(
  p_monday_dispatch_enabled boolean DEFAULT false,
  p_monday_lifecycle_enabled boolean DEFAULT false,
  p_monday_reconcile_enabled boolean DEFAULT false
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH required_workers AS (
    SELECT worker, freshness FROM (VALUES
      ('handoff-dispatch'::text, interval '20 minutes'),
      ('session-expiry'::text, interval '20 minutes'),
      ('deletion-worker'::text, interval '20 minutes')
    ) AS base(worker, freshness)
    UNION ALL SELECT 'monday-dispatch', interval '20 minutes' WHERE p_monday_dispatch_enabled
    UNION ALL SELECT 'monday-lifecycle', interval '26 hours' WHERE p_monday_lifecycle_enabled
    UNION ALL SELECT 'monday-reconcile', interval '8 days' WHERE p_monday_reconcile_enabled
  ), stale AS (
    SELECT required_workers.worker FROM required_workers LEFT JOIN public.scheduler_heartbeats heartbeat USING (worker)
    WHERE heartbeat.last_seen_at IS NULL OR heartbeat.last_seen_at < now() - required_workers.freshness
  ), outbox AS (
    SELECT floor(extract(epoch FROM now() - min(created_at)))::integer AS age FROM public.handoff_outbox WHERE state = 'pending'
  ), expiry AS (
    SELECT count(*)::integer AS backlog FROM public.sessions WHERE draft_expires_at <= now()
  ), deletions AS (
    SELECT floor(extract(epoch FROM now() - min(requested_at)))::integer AS age, count(*)::integer AS backlog FROM public.deletion_jobs WHERE state <> 'completed'
  ), monday AS (
    SELECT floor(extract(epoch FROM now() - min(created_at) FILTER (WHERE operation = 'upsert' AND state IN ('pending', 'claiming', 'sending'))))::integer AS oldest_pending,
      count(*) FILTER (WHERE state = 'delivery_unknown')::integer AS delivery_unknown_count,
      count(*) FILTER (WHERE state = 'conflict')::integer AS conflict_count,
      count(*) FILTER (WHERE state = 'failed')::integer AS failed_count,
      count(*) FILTER (WHERE state IN ('claiming', 'sending') AND claim_expires_at <= now())::integer AS expired_lease_count,
      count(*) FILTER (WHERE last_error_code = 'monday_schema_drift')::integer AS schema_incident_count,
      count(*) FILTER (WHERE last_error_code IN ('monday_auth_failed', 'monday_permission_denied'))::integer AS permission_incident_count,
      count(*) FILTER (WHERE last_error_code = 'monday_rate_limited')::integer AS rate_limited_count,
      floor(extract(epoch FROM now() - min(created_at) FILTER (WHERE operation = 'delete' AND state IN ('pending', 'claiming', 'sending', 'delivery_unknown'))))::integer AS oldest_pending_deletion
    FROM public.monday_sync_outbox
  ), reviews AS (
    SELECT count(*)::integer AS overdue_count, floor(extract(epoch FROM now() - min(review_due_at)))::integer AS oldest_overdue FROM public.crm_leads WHERE lifecycle_state = 'review_overdue'
  )
  SELECT jsonb_build_object(
    'healthy', NOT EXISTS (SELECT 1 FROM stale) AND coalesce((SELECT age FROM outbox), 0) <= 900 AND (SELECT backlog FROM expiry) = 0
      AND coalesce((SELECT age FROM deletions), 0) <= 86400
      AND (NOT p_monday_dispatch_enabled OR (coalesce((SELECT oldest_pending FROM monday), 0) <= 900 AND (SELECT delivery_unknown_count FROM monday) = 0 AND (SELECT conflict_count FROM monday) = 0 AND (SELECT failed_count FROM monday) = 0 AND (SELECT expired_lease_count FROM monday) = 0 AND (SELECT schema_incident_count FROM monday) = 0 AND (SELECT permission_incident_count FROM monday) = 0))
      AND (NOT p_monday_lifecycle_enabled OR coalesce((SELECT oldest_overdue FROM reviews), 0) <= 86400),
    'stale_workers', coalesce((SELECT jsonb_agg(worker ORDER BY worker) FROM stale), '[]'::jsonb),
    'oldest_pending_outbox_seconds', (SELECT age FROM outbox), 'expired_session_backlog', (SELECT backlog FROM expiry),
    'oldest_pending_deletion_seconds', (SELECT age FROM deletions), 'pending_deletion_count', (SELECT backlog FROM deletions),
    'oldest_pending_monday_seconds', (SELECT oldest_pending FROM monday), 'monday_delivery_unknown_count', (SELECT delivery_unknown_count FROM monday),
    'monday_conflict_count', (SELECT conflict_count FROM monday), 'monday_failed_count', (SELECT failed_count FROM monday),
    'monday_expired_lease_count', (SELECT expired_lease_count FROM monday), 'monday_schema_incident_count', (SELECT schema_incident_count FROM monday),
    'monday_permission_incident_count', (SELECT permission_incident_count FROM monday), 'monday_rate_limited_count', (SELECT rate_limited_count FROM monday),
    'oldest_pending_monday_deletion_seconds', (SELECT oldest_pending_deletion FROM monday), 'overdue_crm_review_count', (SELECT overdue_count FROM reviews),
    'oldest_overdue_crm_review_seconds', (SELECT oldest_overdue FROM reviews)
  );
$$;

REVOKE ALL ON FUNCTION public.claim_monday_reconciliation_page(), public.record_monday_reconciled_item(uuid, text, text, boolean, boolean), public.record_monday_reconciliation_cursor(uuid, text), public.finish_monday_reconciliation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scheduler_health(boolean, boolean, boolean) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION public.claim_monday_reconciliation_page(), public.record_monday_reconciled_item(uuid, text, text, boolean, boolean), public.record_monday_reconciliation_cursor(uuid, text), public.finish_monday_reconciliation(uuid) FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION public.claim_monday_reconciliation_page(), public.record_monday_reconciled_item(uuid, text, text, boolean, boolean), public.record_monday_reconciliation_cursor(uuid, text), public.finish_monday_reconciliation(uuid) FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.claim_monday_reconciliation_page(), public.record_monday_reconciled_item(uuid, text, text, boolean, boolean), public.record_monday_reconciliation_cursor(uuid, text), public.finish_monday_reconciliation(uuid), public.scheduler_health(boolean, boolean, boolean) TO service_role; END IF;
END $$;

-- END 053 053_monday_reconciliation.sql
INSERT INTO public.schema_migrations (version, filename) VALUES ('053', '053_monday_reconciliation.sql');

DO $$
BEGIN
  IF (SELECT count(*) FROM public.schema_migrations WHERE (version, filename) IN (('044', '044_monday_crm_projection_tables.sql'), ('047', '047_atomic_crm_approval.sql'), ('048', '048_monday_sync_state_machine.sql'), ('049', '049_monday_crm_lifecycle.sql'), ('052', '052_monday_scheduler_health.sql'), ('053', '053_monday_reconciliation.sql'))) <> 6 THEN
    RAISE EXCEPTION 'CRM migration verification failed';
  END IF;
END $$;
COMMIT;
