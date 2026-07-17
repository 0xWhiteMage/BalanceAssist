BEGIN;
SELECT pg_advisory_xact_lock(90442057);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '056' AND filename = '056_trust_centered_session_controls.sql') THEN
    RAISE EXCEPTION 'trust feedback migration 057 baseline 056 is not recorded with its reviewed filename';
  END IF;
  IF to_regclass('public.sessions') IS NULL OR to_regclass('public.events') IS NULL THEN
    RAISE EXCEPTION 'trust feedback migration 057 baseline schema signatures are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '057') THEN
    RAISE EXCEPTION 'reviewed trust feedback migration 057 is already recorded';
  END IF;
END $$;

-- BEGIN 057 057_event_deletion_freeze.sql
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
-- END 057 057_event_deletion_freeze.sql

INSERT INTO public.schema_migrations (version, filename) VALUES ('057', '057_event_deletion_freeze.sql');

DO $$
BEGIN
  IF to_regprocedure('public.guard_event_session_active()') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.events'::regclass
        AND tgname = 'events_require_active_session'
        AND NOT tgisinternal
        AND tgenabled = 'O'
        AND tgfoid = 'public.guard_event_session_active()'::regprocedure
        AND pg_get_triggerdef(oid) ~* 'BEFORE INSERT ON public.events FOR EACH ROW EXECUTE FUNCTION public.guard_event_session_active\(\)'
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.schema_migrations
      WHERE version = '057' AND filename = '057_event_deletion_freeze.sql'
    ) THEN
    RAISE EXCEPTION 'trust feedback migration 057 verification failed';
  END IF;
END $$;
COMMIT;
