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
