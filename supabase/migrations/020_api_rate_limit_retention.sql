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
