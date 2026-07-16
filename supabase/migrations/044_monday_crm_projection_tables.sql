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
