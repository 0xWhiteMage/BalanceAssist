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
