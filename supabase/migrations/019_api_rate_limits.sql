-- Durable, atomic rate-limit buckets. Keys are SHA-256 hashes supplied by server routes.
CREATE TABLE public.api_rate_limits (
  key_hash text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.api_rate_limits FROM PUBLIC;

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

  -- Low-volume opportunistic cleanup keeps expired buckets bounded without a scheduler.
  DELETE FROM public.api_rate_limits
  WHERE updated_at < v_now - interval '7 days';

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

REVOKE ALL ON FUNCTION public.consume_api_rate_limit(text, integer, integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.api_rate_limits FROM anon;
    REVOKE ALL ON FUNCTION public.consume_api_rate_limit(text, integer, integer) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.api_rate_limits FROM authenticated;
    REVOKE ALL ON FUNCTION public.consume_api_rate_limit(text, integer, integer) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(text, integer, integer) TO service_role;
  END IF;
END
$$;
