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
