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
