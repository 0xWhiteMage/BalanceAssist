-- Bound Telegram replay records and reserve cumulative upload capacity atomically.
CREATE OR REPLACE FUNCTION public.prune_processed_telegram_updates(
  p_retention interval DEFAULT interval '30 days',
  p_batch_size integer DEFAULT 1000
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE deleted_count integer;
BEGIN
  IF p_retention < interval '1 day' OR p_batch_size < 1 OR p_batch_size > 10000 THEN
    RAISE EXCEPTION 'invalid Telegram replay retention arguments';
  END IF;
  WITH expired AS (
    SELECT update_id FROM public.processed_telegram_updates
    WHERE received_at < now() - p_retention
    ORDER BY received_at
    LIMIT p_batch_size
  )
  DELETE FROM public.processed_telegram_updates updates
  USING expired WHERE updates.update_id = expired.update_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END $$;

CREATE TABLE public.session_upload_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes'
);
CREATE INDEX session_upload_reservations_session_idx
  ON public.session_upload_reservations(session_id);
CREATE INDEX session_upload_reservations_expiry_idx
  ON public.session_upload_reservations(expires_at);
ALTER TABLE public.session_upload_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.session_upload_reservations FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.reserve_session_upload_quota(
  p_session_id uuid,
  p_size_bytes bigint,
  p_max_bytes bigint
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE reservation_id uuid; used_bytes bigint;
BEGIN
  IF p_size_bytes < 1 OR p_max_bytes < 1 OR p_size_bytes > p_max_bytes THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));
  DELETE FROM public.session_upload_reservations WHERE expires_at <= now();
  SELECT
    COALESCE((SELECT sum(size_bytes) FROM public.uploaded_files
      WHERE session_id = p_session_id AND (status IS NULL OR status NOT IN ('expired', 'suppressed'))), 0) +
    COALESCE((SELECT sum(size_bytes) FROM public.session_upload_reservations
      WHERE session_id = p_session_id), 0)
  INTO used_bytes;
  IF used_bytes + p_size_bytes > p_max_bytes THEN RETURN NULL; END IF;
  INSERT INTO public.session_upload_reservations(session_id, size_bytes)
  VALUES (p_session_id, p_size_bytes) RETURNING id INTO reservation_id;
  RETURN reservation_id;
END $$;

CREATE OR REPLACE FUNCTION public.release_session_upload_quota(p_reservation_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM public.session_upload_reservations WHERE id = p_reservation_id;
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.prune_processed_telegram_updates(interval, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_session_upload_quota(uuid, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_session_upload_quota(uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.session_upload_reservations FROM anon;
    REVOKE ALL ON FUNCTION public.prune_processed_telegram_updates(interval, integer), public.reserve_session_upload_quota(uuid, bigint, bigint), public.release_session_upload_quota(uuid) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.session_upload_reservations FROM authenticated;
    REVOKE ALL ON FUNCTION public.prune_processed_telegram_updates(interval, integer), public.reserve_session_upload_quota(uuid, bigint, bigint), public.release_session_upload_quota(uuid) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.prune_processed_telegram_updates(interval, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.reserve_session_upload_quota(uuid, bigint, bigint) TO service_role;
    GRANT EXECUTE ON FUNCTION public.release_session_upload_quota(uuid) TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'telegram-replay-retention',
      '43 3 * * *',
      'select public.prune_processed_telegram_updates(interval ''30 days'', 1000)'
    );
  END IF;
END $$;
