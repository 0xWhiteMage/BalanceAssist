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
