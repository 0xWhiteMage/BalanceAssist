-- One-use PKCE attempts and the singleton encrypted Monday OAuth 2.1 connection.
CREATE TABLE public.monday_oauth_attempts (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  encrypted_code_verifier text NOT NULL CHECK (length(encrypted_code_verifier) BETWEEN 32 AND 32768),
  redirect_uri text NOT NULL CHECK (length(redirect_uri) BETWEEN 8 AND 2048),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX monday_oauth_attempts_expiry_idx ON public.monday_oauth_attempts(expires_at);

CREATE TABLE public.monday_oauth_connection (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  encrypted_access_token text NOT NULL CHECK (length(encrypted_access_token) BETWEEN 32 AND 32768),
  encrypted_refresh_token text NOT NULL CHECK (length(encrypted_refresh_token) BETWEEN 32 AND 32768),
  access_expires_at timestamptz NOT NULL,
  scopes text[] NOT NULL CHECK (cardinality(scopes) > 0),
  account_id bigint NOT NULL CHECK (account_id = 3603500),
  board_id bigint NOT NULL CHECK (board_id = 18421762586),
  token_version integer NOT NULL DEFAULT 1 CHECK (token_version > 0),
  refresh_lease_owner uuid,
  refresh_lease_expires_at timestamptz,
  installed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((refresh_lease_owner IS NULL) = (refresh_lease_expires_at IS NULL))
);

ALTER TABLE public.monday_oauth_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monday_oauth_connection ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.monday_oauth_attempts, public.monday_oauth_connection FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.consume_monday_oauth_attempt(p_state_hash text)
RETURNS TABLE(encrypted_code_verifier text, redirect_uri text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE consumed public.monday_oauth_attempts%ROWTYPE;
BEGIN
  IF p_state_hash !~ '^[0-9a-f]{64}$' THEN RETURN; END IF;
  DELETE FROM public.monday_oauth_attempts
  WHERE state_hash = p_state_hash
  RETURNING * INTO consumed;
  IF FOUND AND consumed.expires_at > now() THEN
    encrypted_code_verifier := consumed.encrypted_code_verifier;
    redirect_uri := consumed.redirect_uri;
    RETURN NEXT;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.install_monday_oauth_connection(
  p_encrypted_access_token text,
  p_encrypted_refresh_token text,
  p_access_expires_at timestamptz,
  p_scopes text[],
  p_account_id bigint,
  p_board_id bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_account_id <> 3603500 OR p_board_id <> 18421762586 OR
     p_access_expires_at <= now() OR NOT p_scopes @> ARRAY['me:read', 'account:read', 'boards:read', 'boards:write']::text[] OR
     length(p_encrypted_access_token) < 32 OR length(p_encrypted_refresh_token) < 32 THEN
    RAISE EXCEPTION 'invalid Monday OAuth connection';
  END IF;
  INSERT INTO public.monday_oauth_connection AS connection(
    singleton, encrypted_access_token, encrypted_refresh_token, access_expires_at,
    scopes, account_id, board_id
  ) VALUES (
    true, p_encrypted_access_token, p_encrypted_refresh_token, p_access_expires_at,
    p_scopes, p_account_id, p_board_id
  )
  ON CONFLICT (singleton) DO UPDATE SET
    encrypted_access_token = EXCLUDED.encrypted_access_token,
    encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
    access_expires_at = EXCLUDED.access_expires_at,
    scopes = EXCLUDED.scopes,
    account_id = EXCLUDED.account_id,
    board_id = EXCLUDED.board_id,
    token_version = connection.token_version + 1,
    refresh_lease_owner = NULL,
    refresh_lease_expires_at = NULL,
    installed_at = now(),
    updated_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.acquire_monday_oauth_refresh_lease(
  p_owner uuid,
  p_lease_seconds integer DEFAULT 15
) RETURNS TABLE(acquired boolean, encrypted_refresh_token text, token_version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_owner IS NULL OR p_lease_seconds < 5 OR p_lease_seconds > 60 THEN
    RAISE EXCEPTION 'invalid Monday OAuth refresh lease';
  END IF;
  RETURN QUERY
  WITH leased AS (
    UPDATE public.monday_oauth_connection connection
    SET refresh_lease_owner = p_owner,
        refresh_lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        updated_at = now()
    WHERE connection.singleton = true
      AND (connection.refresh_lease_expires_at IS NULL OR connection.refresh_lease_expires_at <= now())
    RETURNING connection.encrypted_refresh_token, connection.token_version
  )
  SELECT true, leased.encrypted_refresh_token, leased.token_version FROM leased
  UNION ALL
  SELECT false, NULL::text, NULL::integer WHERE NOT EXISTS (SELECT 1 FROM leased);
END $$;

CREATE OR REPLACE FUNCTION public.rotate_monday_oauth_tokens(
  p_owner uuid,
  p_expected_version integer,
  p_encrypted_access_token text,
  p_encrypted_refresh_token text,
  p_access_expires_at timestamptz,
  p_scopes text[]
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_access_expires_at <= now() OR NOT p_scopes @> ARRAY['me:read', 'account:read', 'boards:read', 'boards:write']::text[] OR
     length(p_encrypted_access_token) < 32 OR length(p_encrypted_refresh_token) < 32 THEN
    RETURN false;
  END IF;
  UPDATE public.monday_oauth_connection connection
  SET encrypted_access_token = p_encrypted_access_token,
      encrypted_refresh_token = p_encrypted_refresh_token,
      access_expires_at = p_access_expires_at,
      scopes = p_scopes,
      token_version = connection.token_version + 1,
      refresh_lease_owner = NULL,
      refresh_lease_expires_at = NULL,
      updated_at = now()
  WHERE connection.singleton = true
    AND connection.token_version = p_expected_version
    AND connection.refresh_lease_owner = p_owner
    AND connection.refresh_lease_expires_at > now();
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.disconnect_monday_oauth_connection(
  p_owner uuid,
  p_expected_version integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM public.monday_oauth_connection connection
  WHERE connection.singleton = true
    AND connection.token_version = p_expected_version
    AND connection.refresh_lease_owner = p_owner
    AND connection.refresh_lease_expires_at > now();
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.consume_monday_oauth_attempt(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.install_monday_oauth_connection(text, text, timestamptz, text[], bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acquire_monday_oauth_refresh_lease(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rotate_monday_oauth_tokens(uuid, integer, text, text, timestamptz, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disconnect_monday_oauth_connection(uuid, integer) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.monday_oauth_attempts, public.monday_oauth_connection FROM anon;
    REVOKE ALL ON FUNCTION public.consume_monday_oauth_attempt(text), public.install_monday_oauth_connection(text, text, timestamptz, text[], bigint, bigint), public.acquire_monday_oauth_refresh_lease(uuid, integer), public.rotate_monday_oauth_tokens(uuid, integer, text, text, timestamptz, text[]), public.disconnect_monday_oauth_connection(uuid, integer) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.monday_oauth_attempts, public.monday_oauth_connection FROM authenticated;
    REVOKE ALL ON FUNCTION public.consume_monday_oauth_attempt(text), public.install_monday_oauth_connection(text, text, timestamptz, text[], bigint, bigint), public.acquire_monday_oauth_refresh_lease(uuid, integer), public.rotate_monday_oauth_tokens(uuid, integer, text, text, timestamptz, text[]), public.disconnect_monday_oauth_connection(uuid, integer) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.monday_oauth_attempts, public.monday_oauth_connection TO service_role;
    GRANT EXECUTE ON FUNCTION public.consume_monday_oauth_attempt(text), public.install_monday_oauth_connection(text, text, timestamptz, text[], bigint, bigint), public.acquire_monday_oauth_refresh_lease(uuid, integer), public.rotate_monday_oauth_tokens(uuid, integer, text, text, timestamptz, text[]), public.disconnect_monday_oauth_connection(uuid, integer) TO service_role;
  END IF;
END $$;
