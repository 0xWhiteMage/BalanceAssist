BEGIN;
SELECT pg_advisory_xact_lock(90442059);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '058' AND filename = '058_unsent_crm_deletion.sql') THEN
    RAISE EXCEPTION 'consent 1.2 compatibility migration 059 baseline 058 is not recorded with its reviewed filename';
  END IF;
  IF to_regprocedure('public.assert_session_processing_allowed(uuid)') IS NULL THEN
    RAISE EXCEPTION 'consent 1.2 compatibility migration 059 baseline function signature is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '059') THEN
    RAISE EXCEPTION 'reviewed consent 1.2 compatibility migration 059 is already recorded';
  END IF;
END $$;

-- BEGIN 059 059_consent_1_2_compatibility.sql
CREATE OR REPLACE FUNCTION public.assert_session_processing_allowed(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_deletion_state text; v_analysis record;
BEGIN
  SELECT deletion_state INTO v_deletion_state FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002'; END IF;
  IF v_deletion_state <> 'active' THEN RAISE EXCEPTION 'SESSION_DELETION_REQUESTED' USING ERRCODE = '55000'; END IF;
  SELECT granted, notice_version INTO v_analysis FROM public.session_consents
  WHERE session_id = p_session_id AND scope = 'analysis'
  ORDER BY created_at DESC, id DESC LIMIT 1;
  IF v_analysis.granted IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ANALYSIS_CONSENT_REQUIRED' USING ERRCODE = '55000';
  END IF;
  RETURN v_analysis.notice_version = '1.2';
END;
$$;
-- END 059 059_consent_1_2_compatibility.sql

INSERT INTO public.schema_migrations (version, filename) VALUES ('059', '059_consent_1_2_compatibility.sql');

DO $$
BEGIN
  IF position('RETURN v_analysis.notice_version = ''1.2''' IN pg_get_functiondef('public.assert_session_processing_allowed(uuid)'::regprocedure)) = 0
    OR NOT EXISTS (
      SELECT 1 FROM public.schema_migrations
      WHERE version = '059' AND filename = '059_consent_1_2_compatibility.sql'
    ) THEN
    RAISE EXCEPTION 'consent 1.2 compatibility migration 059 verification failed';
  END IF;
END $$;
COMMIT;
