-- Balance Assist production migration bundle: 019-043.
-- Run only after a current database backup and schema audit.
-- Migrations 038-043 are destructive cleanup migrations: use the protected cleanup workflow or an equivalent approved maintenance window.
-- Do not run this bundle against a database that has not completed the verified 001-018 baseline.

-- ============================================================================
-- BEGIN 019_api_rate_limits.sql
-- ============================================================================
-- Durable, atomic rate-limit buckets. Keys are SHA-256 hashes supplied by server routes.
CREATE TABLE public.api_rate_limits (
  key_hash text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.api_rate_limits FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS TABLE(permitted boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_window_started_at timestamptz;
  v_request_count integer;
BEGIN
  IF length(p_key_hash) <> 64 OR p_limit < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'invalid rate limit arguments';
  END IF;

  -- Low-volume opportunistic cleanup keeps expired buckets bounded without a scheduler.
  DELETE FROM public.api_rate_limits
  WHERE updated_at < v_now - interval '7 days';

  INSERT INTO public.api_rate_limits AS limits (key_hash, window_started_at, request_count, updated_at)
  VALUES (p_key_hash, v_now, 1, v_now)
  ON CONFLICT (key_hash) DO UPDATE
  SET window_started_at = CASE
        WHEN limits.window_started_at <= v_now - make_interval(secs => p_window_seconds) THEN v_now
        ELSE limits.window_started_at
      END,
      request_count = CASE
        WHEN limits.window_started_at <= v_now - make_interval(secs => p_window_seconds) THEN 1
        ELSE limits.request_count + 1
      END,
      updated_at = v_now
  RETURNING window_started_at, request_count INTO v_window_started_at, v_request_count;

  permitted := v_request_count <= p_limit;
  retry_after_seconds := CASE
    WHEN permitted THEN 0
    ELSE greatest(1, ceil(extract(epoch FROM (v_window_started_at + make_interval(secs => p_window_seconds) - v_now)))::integer)
  END;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_api_rate_limit(text, integer, integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.api_rate_limits FROM anon;
    REVOKE ALL ON FUNCTION public.consume_api_rate_limit(text, integer, integer) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.api_rate_limits FROM authenticated;
    REVOKE ALL ON FUNCTION public.consume_api_rate_limit(text, integer, integer) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(text, integer, integer) TO service_role;
  END IF;
END
$$;

-- END 019_api_rate_limits.sql

-- ============================================================================
-- BEGIN 020_api_rate_limit_retention.sql
-- ============================================================================
-- Keep hot-path consumes constant-time; retention runs separately in bounded batches.
CREATE INDEX api_rate_limits_updated_at_idx ON public.api_rate_limits (updated_at);

CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS TABLE(permitted boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_window_started_at timestamptz;
  v_request_count integer;
BEGIN
  IF length(p_key_hash) <> 64 OR p_limit < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'invalid rate limit arguments';
  END IF;

  INSERT INTO public.api_rate_limits AS limits (key_hash, window_started_at, request_count, updated_at)
  VALUES (p_key_hash, v_now, 1, v_now)
  ON CONFLICT (key_hash) DO UPDATE
  SET window_started_at = CASE
        WHEN limits.window_started_at <= v_now - make_interval(secs => p_window_seconds) THEN v_now
        ELSE limits.window_started_at
      END,
      request_count = CASE
        WHEN limits.window_started_at <= v_now - make_interval(secs => p_window_seconds) THEN 1
        ELSE limits.request_count + 1
      END,
      updated_at = v_now
  RETURNING window_started_at, request_count INTO v_window_started_at, v_request_count;

  permitted := v_request_count <= p_limit;
  retry_after_seconds := CASE
    WHEN permitted THEN 0
    ELSE greatest(1, ceil(extract(epoch FROM (v_window_started_at + make_interval(secs => p_window_seconds) - v_now)))::integer)
  END;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.prune_api_rate_limits(p_batch_size integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_batch_size < 1 OR p_batch_size > 1000 THEN
    RAISE EXCEPTION 'invalid rate limit prune batch size';
  END IF;

  WITH expired AS (
    SELECT ctid
    FROM public.api_rate_limits
    WHERE updated_at < clock_timestamp() - interval '7 days'
    ORDER BY updated_at
    LIMIT p_batch_size
  )
  DELETE FROM public.api_rate_limits AS limits
  USING expired
  WHERE limits.ctid = expired.ctid;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_api_rate_limits(integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.prune_api_rate_limits(integer) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.prune_api_rate_limits(integer) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('api-rate-limit-retention', '17 3 * * *', 'select public.prune_api_rate_limits(500)');
  END IF;
END
$$;

-- END 020_api_rate_limit_retention.sql

-- ============================================================================
-- BEGIN 021_session_consents.sql
-- ============================================================================
-- Immutable consent transitions are the authority for data-processing scopes.
CREATE TABLE public.session_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('analysis', 'producer_transfer')),
  granted boolean NOT NULL,
  notice_version text NOT NULL,
  provenance text NOT NULL CHECK (provenance = 'session_capability'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX session_consents_session_scope_created_at_idx
  ON public.session_consents (session_id, scope, created_at);
CREATE INDEX session_consents_session_created_at_idx
  ON public.session_consents (session_id, created_at);

ALTER TABLE public.session_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.session_consents FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.session_consents FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.session_consents FROM authenticated;
  END IF;
END
$$;

-- END 021_session_consents.sql

-- ============================================================================
-- BEGIN 022_session_consents_append_only.sql
-- ============================================================================
-- Harden the deployed ledger without changing its historical creation migration.
CREATE OR REPLACE FUNCTION public.reject_session_consent_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'session_consents is append-only';
END;
$$;

CREATE TRIGGER session_consents_reject_update
BEFORE UPDATE ON public.session_consents
FOR EACH ROW EXECUTE FUNCTION public.reject_session_consent_mutation();

CREATE TRIGGER session_consents_reject_delete
BEFORE DELETE ON public.session_consents
FOR EACH ROW EXECUTE FUNCTION public.reject_session_consent_mutation();

CREATE INDEX session_consents_session_scope_created_id_idx
  ON public.session_consents (session_id, scope, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.record_session_consent(
  p_session_id uuid,
  p_scope text,
  p_granted boolean,
  p_notice_version text
)
RETURNS TABLE (analysis boolean, producer_transfer boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_session_id IS NULL
    OR p_scope NOT IN ('analysis', 'producer_transfer')
    OR coalesce(trim(p_notice_version), '') = '' THEN
    RAISE EXCEPTION 'invalid consent transition' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.session_consents (session_id, scope, granted, notice_version, provenance)
  VALUES (p_session_id, p_scope, p_granted, p_notice_version, 'session_capability');

  RETURN QUERY
  SELECT
    coalesce((SELECT granted FROM public.session_consents WHERE session_id = p_session_id AND scope = 'analysis' ORDER BY created_at DESC, id DESC LIMIT 1), false),
    coalesce((SELECT granted FROM public.session_consents WHERE session_id = p_session_id AND scope = 'producer_transfer' ORDER BY created_at DESC, id DESC LIMIT 1), false);
END;
$$;

REVOKE ALL ON FUNCTION public.reject_session_consent_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_session_consent(uuid, text, boolean, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.record_session_consent(uuid, text, boolean, text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.record_session_consent(uuid, text, boolean, text) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.record_session_consent(uuid, text, boolean, text) TO service_role;
  END IF;
END
$$;

-- END 022_session_consents_append_only.sql

-- ============================================================================
-- BEGIN 023_temporary_session_retention.sql
-- ============================================================================
ALTER TABLE public.sessions
  ADD COLUMN draft_expires_at timestamptz,
  ADD COLUMN last_activity_at timestamptz;

UPDATE public.sessions
SET last_activity_at = coalesce(updated_at, created_at, now()),
    draft_expires_at = coalesce(updated_at, created_at, now()) + interval '24 hours'
WHERE draft_expires_at IS NULL;

ALTER TABLE public.sessions
  ALTER COLUMN draft_expires_at SET NOT NULL,
  ALTER COLUMN last_activity_at SET NOT NULL;

CREATE INDEX sessions_draft_expires_at_idx ON public.sessions (draft_expires_at);

CREATE OR REPLACE FUNCTION public.purge_expired_temporary_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE deleted_count integer;
BEGIN
  DELETE FROM public.sessions WHERE draft_expires_at <= now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_temporary_sessions() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION public.purge_expired_temporary_sessions() FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION public.purge_expired_temporary_sessions() FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.purge_expired_temporary_sessions() TO service_role; END IF;
END $$;

-- END 023_temporary_session_retention.sql

-- ============================================================================
-- BEGIN 024_temporary_expiry_hardening.sql
-- ============================================================================
ALTER TABLE public.sessions
  ALTER COLUMN last_activity_at SET DEFAULT now(),
  ALTER COLUMN draft_expires_at SET DEFAULT (now() + interval '24 hours');

CREATE OR REPLACE FUNCTION public.reject_session_consent_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.session_purge', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'session_consents is append-only';
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_expired_temporary_sessions()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE deleted_count integer;
BEGIN
  PERFORM set_config('app.session_purge', 'on', true);
  DELETE FROM public.sessions WHERE draft_expires_at <= now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.authorize_handoff_send(p_handoff_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  handoff public.handoff_outbox%ROWTYPE;
  session_row public.sessions%ROWTYPE;
BEGIN
  SELECT * INTO handoff
  FROM public.handoff_outbox
  WHERE id = p_handoff_id AND state = 'claiming'
  FOR UPDATE;

  IF NOT FOUND THEN RETURN false; END IF;

  SELECT * INTO session_row
  FROM public.sessions
  WHERE id = handoff.session_id
  FOR KEY SHARE;

  RETURN FOUND
    AND handoff.session_id = session_row.id
    AND session_row.draft_expires_at > now();
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_handoff_send(uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION public.authorize_handoff_send(uuid) FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION public.authorize_handoff_send(uuid) FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.authorize_handoff_send(uuid) TO service_role; END IF;
END $$;

-- END 024_temporary_expiry_hardening.sql

-- ============================================================================
-- BEGIN 025_in_flight_handoff_retention.sql
-- ============================================================================
DROP FUNCTION IF EXISTS public.purge_expired_temporary_sessions();

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

REVOKE ALL ON FUNCTION public.purge_expired_temporary_sessions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_next_handoff() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION public.purge_expired_temporary_sessions() FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION public.purge_expired_temporary_sessions() FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.purge_expired_temporary_sessions() TO service_role; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION public.claim_next_handoff() FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION public.claim_next_handoff() FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.claim_next_handoff() TO service_role; END IF;
END $$;

-- END 025_in_flight_handoff_retention.sql

-- ============================================================================
-- BEGIN 026_handoff_claim_ownership.sql
-- ============================================================================
ALTER TABLE public.handoff_outbox
  ADD COLUMN IF NOT EXISTS claim_token uuid;

CREATE INDEX IF NOT EXISTS handoff_outbox_active_claim_token_idx
  ON public.handoff_outbox (id, claim_token)
  WHERE state = 'claiming';

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
       OR (state = 'claiming' AND claim_expires_at <= now_at)
    ORDER BY CASE WHEN state = 'claiming' THEN 0 ELSE 1 END, next_attempt_at, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF NOT FOUND THEN RETURN; END IF;

    IF handoff.state = 'claiming' THEN
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

CREATE FUNCTION public.renew_handoff_claim(p_handoff_id uuid, p_claim_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.handoff_outbox
  SET claim_expires_at = now() + interval '2 minutes', updated_at = now()
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
  WHERE state = 'claiming' AND claim_expires_at <= now();
  GET DIAGNOSTICS released_count = ROW_COUNT;

  SELECT count(*) INTO deferred_count FROM public.sessions s
  WHERE s.draft_expires_at <= now()
    AND EXISTS (SELECT 1 FROM public.handoff_outbox o WHERE o.session_id = s.id AND o.state = 'claiming' AND o.claim_expires_at > now());

  DELETE FROM public.sessions s
  WHERE s.draft_expires_at <= now()
    AND NOT EXISTS (SELECT 1 FROM public.handoff_outbox o WHERE o.session_id = s.id AND o.state = 'claiming' AND o.claim_expires_at > now());
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN jsonb_build_object('deleted_sessions', deleted_count, 'deferred_sessions', deferred_count, 'released_claims', released_count);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_handoff() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_handoff_claim(uuid, uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION public.claim_next_handoff() FROM anon; REVOKE ALL ON FUNCTION public.renew_handoff_claim(uuid, uuid) FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION public.claim_next_handoff() FROM authenticated; REVOKE ALL ON FUNCTION public.renew_handoff_claim(uuid, uuid) FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.claim_next_handoff() TO service_role; GRANT EXECUTE ON FUNCTION public.renew_handoff_claim(uuid, uuid) TO service_role; END IF;
END $$;

-- END 026_handoff_claim_ownership.sql

-- ============================================================================
-- BEGIN 027_handoff_send_reservations.sql
-- ============================================================================
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

-- END 027_handoff_send_reservations.sql

-- ============================================================================
-- BEGIN 028_handoff_reservation_consent_recheck.sql
-- ============================================================================
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

-- END 028_handoff_reservation_consent_recheck.sql

-- ============================================================================
-- BEGIN 029_private_attachment_storage.sql
-- ============================================================================
-- Private object storage is optional in plain PostgreSQL test environments.
-- The application remains fail-closed until SUPABASE_PRIVATE_UPLOAD_BUCKET names this bucket.
ALTER TABLE public.uploaded_files
  ADD COLUMN IF NOT EXISTS object_key text,
  ADD COLUMN IF NOT EXISTS checksum_sha256 text,
  ADD COLUMN IF NOT EXISTS retention_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

UPDATE public.uploaded_files SET status = 'suppressed' WHERE status = 'quarantined';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uploaded_files_status_check') THEN
    ALTER TABLE public.uploaded_files
      ADD CONSTRAINT uploaded_files_status_check
      CHECK (status IS NULL OR status IN ('stored', 'pending_delivery', 'sent', 'suppressed', 'failed', 'expired')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uploaded_files_stored_metadata_check') THEN
    ALTER TABLE public.uploaded_files
      ADD CONSTRAINT uploaded_files_stored_metadata_check
      CHECK (status <> 'stored' OR (object_key IS NOT NULL AND checksum_sha256 ~ '^[0-9a-f]{64}$' AND retention_expires_at IS NOT NULL AND idempotency_key IS NOT NULL)) NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uploaded_files_idempotency_key_idx
  ON public.uploaded_files (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uploaded_files_object_key_idx
  ON public.uploaded_files (object_key) WHERE object_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS uploaded_files_stored_expiry_idx
  ON public.uploaded_files (retention_expires_at) WHERE status = 'stored';

ALTER TABLE public.uploaded_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.uploaded_files FROM PUBLIC;

-- END 029_private_attachment_storage.sql

-- ============================================================================
-- BEGIN 030_private_attachment_retention.sql
-- ============================================================================
-- Storage schema may be unavailable to generic PostgreSQL runners. Record that state so
-- operations remain unavailable until a private bucket can be verified.
CREATE TABLE IF NOT EXISTS public.private_attachment_cleanup (
  object_key text PRIMARY KEY,
  bucket text NOT NULL,
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  retention_expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status = 'pending_cleanup')
);

CREATE TABLE IF NOT EXISTS public.private_attachment_storage_readiness (
  bucket text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('ready', 'unavailable'))
);

ALTER TABLE public.private_attachment_cleanup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_attachment_storage_readiness ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.private_attachment_cleanup, public.private_attachment_storage_readiness FROM PUBLIC;

INSERT INTO public.private_attachment_storage_readiness (bucket, status)
VALUES ('temporary-attachments', 'unavailable')
ON CONFLICT (bucket) DO UPDATE SET status = EXCLUDED.status;

DROP FUNCTION IF EXISTS public.purge_expired_temporary_sessions();
CREATE OR REPLACE FUNCTION public.purge_expired_temporary_sessions(p_deferred_session_ids uuid[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE deleted_count integer; deferred_count integer; released_count integer;
BEGIN
  PERFORM set_config('app.session_purge', 'on', true);
  UPDATE public.handoff_outbox SET state = 'pending', claim_expires_at = NULL, updated_at = now()
  WHERE state = 'claiming' AND claim_expires_at <= now();
  GET DIAGNOSTICS released_count = ROW_COUNT;
  SELECT count(*) INTO deferred_count FROM public.sessions s WHERE s.draft_expires_at <= now()
    AND (s.id = ANY(p_deferred_session_ids) OR EXISTS (SELECT 1 FROM public.handoff_outbox o WHERE o.session_id = s.id AND o.state = 'claiming' AND o.claim_expires_at > now()));
  DELETE FROM public.sessions s WHERE s.draft_expires_at <= now() AND NOT (s.id = ANY(p_deferred_session_ids))
    AND NOT EXISTS (SELECT 1 FROM public.handoff_outbox o WHERE o.session_id = s.id AND o.state = 'claiming' AND o.claim_expires_at > now());
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN jsonb_build_object('deleted_sessions', deleted_count, 'deferred_sessions', deferred_count, 'released_claims', released_count);
END $$;

REVOKE ALL ON FUNCTION public.purge_expired_temporary_sessions(uuid[]) FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.purge_expired_temporary_sessions(uuid[]) TO service_role; END IF; END $$;

-- END 030_private_attachment_retention.sql

-- ============================================================================
-- BEGIN 031_private_attachment_cleanup_hardening.sql
-- ============================================================================
-- Legacy clients used session-prefixed paths. Retain their metadata only as an
-- explicit deletion obligation; the authenticated worker removes object then row.
ALTER TABLE public.uploaded_files
  ADD COLUMN IF NOT EXISTS cleanup_required_at timestamptz;

UPDATE public.uploaded_files
SET cleanup_required_at = coalesce(cleanup_required_at, now())
WHERE object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/';

-- Old recovery rows encode the session in object_key. Move recoverable entries
-- into the guarded metadata cleanup path, then remove that linkable record.
INSERT INTO public.uploaded_files (
  session_id, storage_path, original_name, mime_type, size_bytes, object_key,
  checksum_sha256, retention_expires_at, idempotency_key, status, cleanup_required_at
)
SELECT s.id, c.object_key, '[redacted]', null, 0, c.object_key,
       c.checksum_sha256, c.retention_expires_at, gen_random_uuid(), 'stored', now()
FROM public.private_attachment_cleanup c
JOIN public.sessions s ON s.id = substring(c.object_key FROM 1 FOR 36)::uuid
WHERE c.object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
ON CONFLICT (object_key) WHERE object_key IS NOT NULL DO UPDATE
SET cleanup_required_at = coalesce(public.uploaded_files.cleanup_required_at, now());

DELETE FROM public.private_attachment_cleanup c
USING public.uploaded_files u
WHERE c.object_key = u.object_key
  AND u.cleanup_required_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS uploaded_files_cleanup_required_idx
  ON public.uploaded_files (retention_expires_at)
  WHERE cleanup_required_at IS NOT NULL;

INSERT INTO public.private_attachment_storage_readiness (bucket, status)
VALUES ('temporary-attachments', 'unavailable')
ON CONFLICT (bucket) DO UPDATE SET status = EXCLUDED.status;

-- END 031_private_attachment_cleanup_hardening.sql

-- ============================================================================
-- BEGIN 032_legacy_cleanup_record_remediation.sql
-- ============================================================================
-- Records left behind when their session was deleted still contain the old
-- session-prefixed name. The service-role cleanup worker deletes the object;
-- this migration removes only the linkable recovery metadata.
DELETE FROM public.private_attachment_cleanup
WHERE object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/';

-- END 032_legacy_cleanup_record_remediation.sql

-- ============================================================================
-- BEGIN 033_private_attachment_live_attestation.sql
-- ============================================================================
-- Verify current catalog state at upload time. A migration-time status row cannot
-- establish that policies or grants have not drifted since deployment.
CREATE OR REPLACE FUNCTION public.private_attachment_storage_is_ready(p_bucket text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT
    p_bucket = 'temporary-attachments'
    AND to_regclass('storage.buckets') IS NOT NULL
    AND to_regclass('storage.objects') IS NOT NULL
    AND EXISTS (SELECT 1 FROM storage.buckets WHERE id = p_bucket AND public = false)
    AND EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'storage' AND c.relname = 'objects' AND c.relrowsecurity
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND roles && ARRAY['public'::name, 'anon'::name, 'authenticated'::name]
    );
$$;

REVOKE ALL ON FUNCTION public.private_attachment_storage_is_ready(text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.private_attachment_storage_is_ready(text) TO service_role;
  END IF;
END $$;

-- END 033_private_attachment_live_attestation.sql

-- ============================================================================
-- BEGIN 034_private_attachment_effective_attestation.sql
-- ============================================================================
-- Standard Supabase table grants are safe when RLS is enabled and no browser
-- policy applies. Check direct and inherited browser-role policy access at call time.
CREATE OR REPLACE FUNCTION public.private_attachment_storage_is_ready(p_bucket text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  WITH RECURSIVE memberships(browser_role, role_oid) AS (
    SELECT r.rolname, r.oid FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
    UNION
    SELECT mships.browser_role, m.roleid
    FROM memberships mships
    JOIN pg_auth_members m ON m.member = mships.role_oid
  ), role_names AS (
    SELECT m.browser_role, r.rolname AS role_name
    FROM memberships m JOIN pg_roles r ON r.oid = m.role_oid
  )
  SELECT p_bucket = 'temporary-attachments'
    AND to_regclass('storage.buckets') IS NOT NULL
    AND to_regclass('storage.objects') IS NOT NULL
    AND EXISTS (SELECT 1 FROM storage.buckets WHERE id = p_bucket AND public = false)
    AND EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'storage' AND c.relname = 'objects' AND c.relrowsecurity
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
        AND ('public'::name = ANY(p.roles) OR EXISTS (
          SELECT 1 FROM role_names WHERE role_name = ANY(p.roles)
        ))
    );
$$;

REVOKE ALL ON FUNCTION public.private_attachment_storage_is_ready(text) FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.private_attachment_storage_is_ready(text) TO service_role; END IF; END $$;

-- END 034_private_attachment_effective_attestation.sql

-- ============================================================================
-- BEGIN 035_schema_migrations_tracker_hardening.sql
-- ============================================================================
-- Databases that recorded 018 before tracker hardening need this forward fix.
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version text PRIMARY KEY,
  filename text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations FROM authenticated;
  END IF;
END
$$;

-- END 035_schema_migrations_tracker_hardening.sql

-- ============================================================================
-- BEGIN 036_atomic_mutations.sql
-- ============================================================================
-- Database-owned mutations prevent route-level read/write races.

ALTER TABLE public.human_messages
  ADD COLUMN IF NOT EXISTS request_id text;

CREATE UNIQUE INDEX IF NOT EXISTS human_messages_session_request_id_key
  ON public.human_messages (session_id, request_id)
  WHERE request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.update_session_draft(
  p_session_id uuid,
  p_expected_draft_version integer,
  p_fields jsonb
)
RETURNS TABLE (draft jsonb, draft_version integer, conflict boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_draft jsonb;
  v_field jsonb;
  v_name text;
  v_value text;
  v_provenance text;
BEGIN
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;

  IF p_expected_draft_version <> v_session.draft_version THEN
    RETURN QUERY SELECT v_session.draft, v_session.draft_version, true;
    RETURN;
  END IF;

  v_draft := v_session.draft;
  FOR v_field IN SELECT value FROM jsonb_array_elements(p_fields) LOOP
    v_name := v_field->>'field';
    v_value := v_field->>'value';
    v_provenance := v_field->>'provenance';
    IF v_name IS NULL OR v_name = '' OR v_provenance NOT IN ('user-stated', 'inferred', 'confirmed', 'cleared') THEN
      RAISE EXCEPTION 'invalid draft field' USING ERRCODE = '22023';
    END IF;
    v_draft := jsonb_set(v_draft, array[v_name], jsonb_build_object(
      'value', CASE WHEN v_provenance = 'cleared' THEN '' ELSE coalesce(v_value, '') END,
      'provenance', v_provenance,
      'updatedAt', now()::text
    ));
  END LOOP;

  UPDATE public.sessions
  SET draft = v_draft,
      draft_version = v_session.draft_version + 1,
      last_activity_at = now(),
      draft_expires_at = now() + interval '24 hours'
  WHERE id = p_session_id;

  RETURN QUERY SELECT v_draft, v_session.draft_version + 1, false;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_session_lead(p_session_id uuid)
RETURNS TABLE (
  persisted boolean,
  consent_required boolean,
  qualification_status text,
  score integer,
  recommended_next_step text,
  lead_id bigint,
  handoff_id uuid
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
  v_lead_id bigint;
  v_handoff_id uuid;
  v_has_signal boolean;
  v_producer_transfer boolean;
BEGIN
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;
  SELECT coalesce(granted, false) INTO v_producer_transfer
  FROM public.session_consents
  WHERE session_id = p_session_id AND scope = 'producer_transfer'
  ORDER BY created_at DESC, id DESC LIMIT 1;
  IF NOT coalesce(v_producer_transfer, false) THEN
    RETURN QUERY SELECT false, true, null::text, null::integer, null::text, null::bigint, null::uuid;
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
    RETURN QUERY SELECT false, false, null::text, null::integer, null::text, null::bigint, null::uuid;
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
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_lead_id;
  IF v_lead_id IS NULL THEN SELECT id INTO v_lead_id FROM public.leads WHERE idempotency_key = 'finalize:' || p_session_id::text; END IF;

  UPDATE public.sessions SET status = CASE WHEN v_status = 'qualified' THEN 'completed' ELSE 'escalated' END WHERE id = p_session_id;
  INSERT INTO public.handoff_outbox (session_id, payload, idempotency_key)
  VALUES (p_session_id, jsonb_build_object('sessionId', p_session_id, 'type', 'approval', 'threadId', v_session.telegram_thread_id, 'summary', 'Project brief: ' || coalesce(nullif(v_scope, ''), 'No scope supplied')), 'finalize:' || p_session_id::text)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_handoff_id;
  IF v_handoff_id IS NULL THEN SELECT id INTO v_handoff_id FROM public.handoff_outbox WHERE idempotency_key = 'finalize:' || p_session_id::text; END IF;
  RETURN QUERY SELECT true, false, v_status, v_score, v_next, v_lead_id, v_handoff_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.relay_human_message(p_session_id uuid, p_request_id text, p_text text)
RETURNS TABLE (persisted boolean, consent_required boolean, message_id bigint, handoff_id uuid, thread_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_message_id bigint;
  v_handoff_id uuid;
  v_producer_transfer boolean;
BEGIN
  IF coalesce(btrim(p_request_id), '') = '' THEN RAISE EXCEPTION 'request id required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;
  SELECT coalesce(granted, false) INTO v_producer_transfer FROM public.session_consents WHERE session_id = p_session_id AND scope = 'producer_transfer' ORDER BY created_at DESC, id DESC LIMIT 1;
  IF NOT coalesce(v_producer_transfer, false) THEN RETURN QUERY SELECT false, true, null::bigint, null::uuid, v_session.telegram_thread_id::bigint; RETURN; END IF;
  INSERT INTO public.human_messages (session_id, sender, text, request_id, telegram_thread_id)
  VALUES (p_session_id, 'user', p_text, p_request_id, v_session.telegram_thread_id)
  ON CONFLICT (session_id, request_id) WHERE request_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_message_id;
  IF v_message_id IS NULL THEN SELECT id INTO v_message_id FROM public.human_messages WHERE session_id = p_session_id AND request_id = p_request_id; END IF;
  INSERT INTO public.handoff_outbox (session_id, payload, idempotency_key)
  VALUES (p_session_id, jsonb_build_object('sessionId', p_session_id, 'type', 'relay', 'messageId', v_message_id, 'threadId', v_session.telegram_thread_id, 'summary', p_text), 'relay:' || v_message_id::text)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_handoff_id;
  IF v_handoff_id IS NULL THEN SELECT id INTO v_handoff_id FROM public.handoff_outbox WHERE idempotency_key = 'relay:' || v_message_id::text; END IF;
  UPDATE public.sessions SET status = 'escalated' WHERE id = p_session_id;
  RETURN QUERY SELECT true, false, v_message_id, v_handoff_id, v_session.telegram_thread_id::bigint;
END;
$$;

REVOKE ALL ON FUNCTION public.update_session_draft(uuid, integer, jsonb), public.finalize_session_lead(uuid), public.relay_human_message(uuid, text, text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.update_session_draft(uuid, integer, jsonb), public.finalize_session_lead(uuid), public.relay_human_message(uuid, text, text) TO service_role;
  END IF;
END $$;

-- END 036_atomic_mutations.sql

-- ============================================================================
-- BEGIN 037_scheduler_health.sql
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.scheduler_heartbeats (
  worker text PRIMARY KEY CHECK (worker IN ('handoff-dispatch', 'session-expiry')),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scheduler_heartbeats ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.scheduler_heartbeats FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.record_scheduler_heartbeat(p_worker text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_worker NOT IN ('handoff-dispatch', 'session-expiry') THEN RAISE EXCEPTION 'unknown scheduler worker' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.scheduler_heartbeats (worker, last_seen_at) VALUES (p_worker, now())
  ON CONFLICT (worker) DO UPDATE SET last_seen_at = excluded.last_seen_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.scheduler_health()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH stale AS (
    SELECT worker FROM unnest(ARRAY['handoff-dispatch', 'session-expiry']) worker
    LEFT JOIN public.scheduler_heartbeats heartbeat USING (worker)
    WHERE heartbeat.last_seen_at IS NULL OR heartbeat.last_seen_at < now() - interval '20 minutes'
  ), outbox AS (
    SELECT floor(extract(epoch FROM now() - min(created_at)))::integer AS age
    FROM public.handoff_outbox WHERE state = 'pending'
  ), expiry AS (
    SELECT count(*)::integer AS backlog FROM public.sessions WHERE draft_expires_at <= now()
  )
  SELECT jsonb_build_object(
    'healthy', NOT EXISTS (SELECT 1 FROM stale) AND coalesce((SELECT age FROM outbox), 0) <= 900 AND (SELECT backlog FROM expiry) = 0,
    'stale_workers', coalesce((SELECT jsonb_agg(worker ORDER BY worker) FROM stale), '[]'::jsonb),
    'oldest_pending_outbox_seconds', (SELECT age FROM outbox),
    'expired_session_backlog', (SELECT backlog FROM expiry)
  );
$$;

REVOKE ALL ON FUNCTION public.record_scheduler_heartbeat(text), public.scheduler_health() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.record_scheduler_heartbeat(text), public.scheduler_health() TO service_role;
  END IF;
END $$;

-- END 037_scheduler_health.sql

-- ============================================================================
-- BEGIN 038_durable_deletion_jobs.sql
-- ============================================================================
CREATE TABLE public.deletion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid UNIQUE REFERENCES public.sessions(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested', 'claimed', 'processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  requested_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  processing_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX deletion_jobs_session_id_key ON public.deletion_jobs (session_id) WHERE session_id IS NOT NULL;
ALTER TABLE public.deletion_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.deletion_jobs FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.request_deletion_job(p_session_id uuid)
RETURNS public.deletion_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE job public.deletion_jobs%ROWTYPE;
BEGIN
  INSERT INTO public.deletion_jobs (session_id) VALUES (p_session_id)
  ON CONFLICT (session_id) WHERE session_id IS NOT NULL DO UPDATE SET
    state = CASE WHEN deletion_jobs.state = 'completed' THEN 'completed' ELSE deletion_jobs.state END,
    updated_at = now()
  RETURNING * INTO job;
  RETURN job;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_deletion_job(p_lease_seconds integer DEFAULT 300)
RETURNS public.deletion_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE job public.deletion_jobs%ROWTYPE;
BEGIN
  SELECT * INTO job FROM public.deletion_jobs
  WHERE state IN ('requested', 'failed') OR (state IN ('claimed', 'processing') AND lease_expires_at <= now())
  ORDER BY requested_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.deletion_jobs SET state = 'claimed', attempts = job.attempts + 1,
    lease_token = gen_random_uuid(), lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    claimed_at = now(), updated_at = now() WHERE id = job.id RETURNING * INTO job;
  RETURN job;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_deletion_job(p_job_id uuid, p_lease_token uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.deletion_jobs SET state = 'processing', processing_at = now(), updated_at = now()
  WHERE id = p_job_id AND state = 'claimed' AND lease_token = p_lease_token AND lease_expires_at > now()
  RETURNING true;
$$;

CREATE OR REPLACE FUNCTION public.fail_deletion_job(p_job_id uuid, p_lease_token uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.deletion_jobs SET state = 'failed', failed_at = now(), lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE id = p_job_id AND state IN ('claimed', 'processing') AND lease_token = p_lease_token
  RETURNING true;
$$;

CREATE OR REPLACE FUNCTION public.delete_session_for_deletion_job(p_job_id uuid, p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target_session_id uuid;
BEGIN
  SELECT session_id INTO target_session_id FROM public.deletion_jobs
  WHERE id = p_job_id AND state = 'processing' AND lease_token = p_lease_token AND lease_expires_at > now() FOR UPDATE;
  IF target_session_id IS NULL THEN RETURN false; END IF;
  DELETE FROM public.sessions WHERE id = target_session_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_deletion_job(p_job_id uuid, p_lease_token uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.deletion_jobs SET state = 'completed', completed_at = now(), lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE id = p_job_id AND state = 'processing' AND lease_token = p_lease_token
  RETURNING true;
$$;

REVOKE ALL ON FUNCTION public.request_deletion_job(uuid), public.claim_deletion_job(integer), public.start_deletion_job(uuid, uuid), public.fail_deletion_job(uuid, uuid), public.delete_session_for_deletion_job(uuid, uuid), public.complete_deletion_job(uuid, uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.request_deletion_job(uuid), public.claim_deletion_job(integer), public.start_deletion_job(uuid, uuid), public.fail_deletion_job(uuid, uuid), public.delete_session_for_deletion_job(uuid, uuid), public.complete_deletion_job(uuid, uuid) TO service_role;
  END IF;
END $$;

-- END 038_durable_deletion_jobs.sql

-- ============================================================================
-- BEGIN 039_deletion_scheduler_health.sql
-- ============================================================================
ALTER TABLE public.scheduler_heartbeats DROP CONSTRAINT scheduler_heartbeats_worker_check;
ALTER TABLE public.scheduler_heartbeats ADD CONSTRAINT scheduler_heartbeats_worker_check CHECK (worker IN ('handoff-dispatch', 'session-expiry', 'deletion-worker'));

CREATE OR REPLACE FUNCTION public.record_scheduler_heartbeat(p_worker text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_worker NOT IN ('handoff-dispatch', 'session-expiry', 'deletion-worker') THEN RAISE EXCEPTION 'unknown scheduler worker' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.scheduler_heartbeats (worker, last_seen_at) VALUES (p_worker, now()) ON CONFLICT (worker) DO UPDATE SET last_seen_at = excluded.last_seen_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.scheduler_health()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH stale AS (
    SELECT worker FROM unnest(ARRAY['handoff-dispatch', 'session-expiry', 'deletion-worker']) worker
    LEFT JOIN public.scheduler_heartbeats heartbeat USING (worker)
    WHERE heartbeat.last_seen_at IS NULL OR heartbeat.last_seen_at < now() - interval '20 minutes'
  ), outbox AS (
    SELECT floor(extract(epoch FROM now() - min(created_at)))::integer AS age FROM public.handoff_outbox WHERE state = 'pending'
  ), expiry AS (
    SELECT count(*)::integer AS backlog FROM public.sessions WHERE draft_expires_at <= now()
  ), deletions AS (
    SELECT floor(extract(epoch FROM now() - min(requested_at)))::integer AS age FROM public.deletion_jobs WHERE state <> 'completed'
  )
  SELECT jsonb_build_object(
    'healthy', NOT EXISTS (SELECT 1 FROM stale) AND coalesce((SELECT age FROM outbox), 0) <= 900 AND (SELECT backlog FROM expiry) = 0 AND coalesce((SELECT age FROM deletions), 0) <= 86400,
    'stale_workers', coalesce((SELECT jsonb_agg(worker ORDER BY worker) FROM stale), '[]'::jsonb),
    'oldest_pending_outbox_seconds', (SELECT age FROM outbox),
    'expired_session_backlog', (SELECT backlog FROM expiry),
    'oldest_pending_deletion_seconds', (SELECT age FROM deletions)
  );
$$;

REVOKE ALL ON FUNCTION public.record_scheduler_heartbeat(text), public.scheduler_health() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.record_scheduler_heartbeat(text), public.scheduler_health() TO service_role; END IF;
END $$;

-- END 039_deletion_scheduler_health.sql

-- ============================================================================
-- BEGIN 040_deletion_recovery_lifecycle.sql
-- ============================================================================
CREATE OR REPLACE FUNCTION public.complete_orphaned_deletion_job(p_job_id uuid, p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.deletion_jobs SET state = 'completed', completed_at = now(), lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE id = p_job_id AND session_id IS NULL AND state IN ('claimed', 'processing') AND lease_token = p_lease_token
    AND NOT EXISTS (SELECT 1 FROM public.private_attachment_cleanup WHERE status = 'pending_cleanup');
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.request_deletion_job(uuid), public.complete_orphaned_deletion_job(uuid, uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.request_deletion_job(uuid), public.complete_orphaned_deletion_job(uuid, uuid) TO service_role; END IF;
END $$;

-- END 040_deletion_recovery_lifecycle.sql

-- ============================================================================
-- BEGIN 041_deletion_backlog_count.sql
-- ============================================================================
CREATE OR REPLACE FUNCTION public.scheduler_health()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH stale AS (
    SELECT worker FROM unnest(ARRAY['handoff-dispatch', 'session-expiry', 'deletion-worker']) worker LEFT JOIN public.scheduler_heartbeats heartbeat USING (worker)
    WHERE heartbeat.last_seen_at IS NULL OR heartbeat.last_seen_at < now() - interval '20 minutes'
  ), outbox AS (SELECT floor(extract(epoch FROM now() - min(created_at)))::integer AS age FROM public.handoff_outbox WHERE state = 'pending'),
  expiry AS (SELECT count(*)::integer AS backlog FROM public.sessions WHERE draft_expires_at <= now()),
  deletions AS (SELECT floor(extract(epoch FROM now() - min(requested_at)))::integer AS age, count(*)::integer AS count FROM public.deletion_jobs WHERE state <> 'completed')
  SELECT jsonb_build_object('healthy', NOT EXISTS (SELECT 1 FROM stale) AND coalesce((SELECT age FROM outbox), 0) <= 900 AND (SELECT backlog FROM expiry) = 0 AND coalesce((SELECT age FROM deletions), 0) <= 86400,
    'stale_workers', coalesce((SELECT jsonb_agg(worker ORDER BY worker) FROM stale), '[]'::jsonb), 'oldest_pending_outbox_seconds', (SELECT age FROM outbox),
    'expired_session_backlog', (SELECT backlog FROM expiry), 'oldest_pending_deletion_seconds', (SELECT age FROM deletions), 'pending_deletion_count', (SELECT count FROM deletions));
$$;
REVOKE ALL ON FUNCTION public.scheduler_health() FROM PUBLIC;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.scheduler_health() TO service_role; END IF; END $$;

-- END 041_deletion_backlog_count.sql

-- ============================================================================
-- BEGIN 042_deletion_recovery_ownership.sql
-- ============================================================================
-- A random owner is assigned per session rather than retaining session identity
-- alongside an opaque object key in recovery records.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS cleanup_owner_id uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.deletion_jobs
  ADD COLUMN IF NOT EXISTS cleanup_owner_id uuid;

ALTER TABLE public.private_attachment_cleanup
  ADD COLUMN IF NOT EXISTS cleanup_owner_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_cleanup_owner_id_key
  ON public.sessions (cleanup_owner_id);

CREATE INDEX IF NOT EXISTS private_attachment_cleanup_owner_idx
  ON public.private_attachment_cleanup (cleanup_owner_id)
  WHERE cleanup_owner_id IS NOT NULL;

-- Only an existing metadata row can prove that a legacy recovery record belongs
-- to a current session. Unknown rows remain unowned and are not job-cleaned.
UPDATE public.private_attachment_cleanup c
SET cleanup_owner_id = s.cleanup_owner_id
FROM public.uploaded_files u
JOIN public.sessions s ON s.id = u.session_id
WHERE c.object_key = u.object_key
  AND c.cleanup_owner_id IS NULL;

CREATE OR REPLACE FUNCTION public.private_attachment_cleanup_owner(p_session_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT cleanup_owner_id FROM public.sessions WHERE id = p_session_id;
$$;

CREATE OR REPLACE FUNCTION public.request_deletion_job(p_session_id uuid)
RETURNS public.deletion_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE job public.deletion_jobs%ROWTYPE;
BEGIN
  INSERT INTO public.deletion_jobs (session_id, cleanup_owner_id)
  SELECT id, cleanup_owner_id FROM public.sessions WHERE id = p_session_id
  ON CONFLICT (session_id) WHERE session_id IS NOT NULL DO UPDATE SET
    state = CASE WHEN deletion_jobs.state = 'completed' THEN 'completed' ELSE deletion_jobs.state END,
    cleanup_owner_id = EXCLUDED.cleanup_owner_id,
    updated_at = now()
  RETURNING * INTO job;
  RETURN job;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_deletion_job(p_lease_seconds integer DEFAULT 300)
RETURNS public.deletion_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE job public.deletion_jobs%ROWTYPE;
BEGIN
  SELECT * INTO job FROM public.deletion_jobs
  WHERE state IN ('requested', 'failed') OR (state IN ('claimed', 'processing') AND lease_expires_at <= now())
  ORDER BY requested_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF job.cleanup_owner_id IS NULL AND job.session_id IS NOT NULL THEN
    UPDATE public.deletion_jobs j SET cleanup_owner_id = s.cleanup_owner_id
    FROM public.sessions s
    WHERE j.id = job.id AND s.id = job.session_id
    RETURNING j.* INTO job;
  END IF;
  UPDATE public.deletion_jobs SET state = 'claimed', attempts = job.attempts + 1,
    lease_token = gen_random_uuid(), lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    claimed_at = now(), updated_at = now() WHERE id = job.id RETURNING * INTO job;
  RETURN job;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_orphaned_deletion_job(p_job_id uuid, p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE job public.deletion_jobs%ROWTYPE;
BEGIN
  SELECT * INTO job FROM public.deletion_jobs
  WHERE id = p_job_id AND session_id IS NULL AND state IN ('claimed', 'processing') AND lease_token = p_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.deletion_jobs SET state = 'completed', completed_at = now(), lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE id = job.id
    AND NOT EXISTS (
      SELECT 1 FROM public.private_attachment_cleanup c
      WHERE c.status = 'pending_cleanup'
        AND c.cleanup_owner_id = job.cleanup_owner_id
    );
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.private_attachment_cleanup_owner(uuid), public.request_deletion_job(uuid), public.complete_orphaned_deletion_job(uuid, uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.private_attachment_cleanup_owner(uuid), public.request_deletion_job(uuid), public.complete_orphaned_deletion_job(uuid, uuid) TO service_role;
  END IF;
END $$;

-- END 042_deletion_recovery_ownership.sql

-- ============================================================================
-- BEGIN 043_deletion_state_batched_cleanup.sql
-- ============================================================================
-- Reserve upload cleanup under the session row lock so deletion atomically
-- closes the reservation gate before external object creation.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS deletion_state text NOT NULL DEFAULT 'active'
  CHECK (deletion_state IN ('active', 'requested', 'deleting'));

CREATE INDEX IF NOT EXISTS uploaded_files_deletion_cleanup_idx
  ON public.uploaded_files (session_id, id)
  WHERE object_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.request_deletion_job(p_session_id uuid)
RETURNS public.deletion_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE job public.deletion_jobs%ROWTYPE; owner uuid;
BEGIN
  SELECT cleanup_owner_id INTO owner FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.sessions SET deletion_state = 'requested' WHERE id = p_session_id;
  INSERT INTO public.deletion_jobs (session_id, cleanup_owner_id)
  VALUES (p_session_id, owner)
  ON CONFLICT (session_id) WHERE session_id IS NOT NULL DO UPDATE SET cleanup_owner_id = EXCLUDED.cleanup_owner_id, updated_at = now()
  RETURNING * INTO job;
  RETURN job;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_private_attachment_cleanup(
  p_session_id uuid, p_bucket text, p_object_key text, p_checksum_sha256 text, p_retention_expires_at timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE owner uuid; state text;
BEGIN
  SELECT cleanup_owner_id, deletion_state INTO owner, state FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR state <> 'active' THEN RETURN false; END IF;
  INSERT INTO public.private_attachment_cleanup (bucket, object_key, checksum_sha256, retention_expires_at, cleanup_owner_id, status)
  VALUES (p_bucket, p_object_key, p_checksum_sha256, p_retention_expires_at, owner, 'pending_cleanup')
  ON CONFLICT (object_key) DO NOTHING;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_deletion_job(p_job_id uuid, p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target_session_id uuid;
BEGIN
  SELECT session_id INTO target_session_id FROM public.deletion_jobs
  WHERE id = p_job_id AND state = 'claimed' AND lease_token = p_lease_token AND lease_expires_at > now() FOR UPDATE;
  IF target_session_id IS NULL THEN RETURN false; END IF;
  UPDATE public.sessions SET deletion_state = 'deleting'
  WHERE id = target_session_id AND deletion_state IN ('requested', 'deleting');
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.deletion_jobs SET state = 'processing', processing_at = now(), updated_at = now() WHERE id = p_job_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.deletion_recovery_cleanup_page(p_cleanup_owner_id uuid, p_bucket text, p_limit integer DEFAULT 100)
RETURNS TABLE(object_key text) LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.object_key FROM public.private_attachment_cleanup c
  WHERE c.cleanup_owner_id = p_cleanup_owner_id AND c.bucket = p_bucket AND c.status = 'pending_cleanup'
  ORDER BY c.object_key LIMIT greatest(1, least(p_limit, 1000));
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
    OR EXISTS (SELECT 1 FROM public.private_attachment_cleanup WHERE cleanup_owner_id = owner AND status = 'pending_cleanup') THEN RETURN false; END IF;
  DELETE FROM public.sessions WHERE id = target_session_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_deletion_job(p_job_id uuid, p_lease_token uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.deletion_jobs j SET state = 'completed', completed_at = now(), lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE j.id = p_job_id AND j.state = 'processing' AND j.lease_token = p_lease_token
    AND NOT EXISTS (SELECT 1 FROM public.private_attachment_cleanup c WHERE c.cleanup_owner_id = j.cleanup_owner_id AND c.status = 'pending_cleanup')
  RETURNING true;
$$;

REVOKE ALL ON FUNCTION public.request_deletion_job(uuid), public.reserve_private_attachment_cleanup(uuid, text, text, text, timestamptz), public.start_deletion_job(uuid, uuid), public.deletion_recovery_cleanup_page(uuid, text, integer), public.delete_session_for_deletion_job(uuid, uuid), public.complete_deletion_job(uuid, uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.request_deletion_job(uuid), public.reserve_private_attachment_cleanup(uuid, text, text, text, timestamptz), public.start_deletion_job(uuid, uuid), public.deletion_recovery_cleanup_page(uuid, text, integer), public.delete_session_for_deletion_job(uuid, uuid), public.complete_deletion_job(uuid, uuid) TO service_role;
  END IF;
END $$;

-- END 043_deletion_state_batched_cleanup.sql
