CREATE OR REPLACE FUNCTION public.guard_event_session_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  session_is_active boolean;
BEGIN
  SELECT true
    INTO session_is_active
  FROM public.sessions
  WHERE id = NEW.session_id
    AND deletion_state = 'active'
    AND draft_expires_at > now()
  FOR SHARE;

  IF NOT COALESCE(session_is_active, false) THEN
    RAISE EXCEPTION 'session_unavailable' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_event_session_active() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS events_require_active_session ON public.events;
CREATE TRIGGER events_require_active_session
  BEFORE INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.guard_event_session_active();
