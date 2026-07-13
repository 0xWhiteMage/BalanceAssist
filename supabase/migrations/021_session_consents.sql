-- Immutable consent transitions are the authority for data-processing scopes.
CREATE TABLE public.session_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('analysis', 'producer_transfer')),
  granted boolean NOT NULL,
  notice_version text NOT NULL,
  provenance text NOT NULL CHECK (provenance = 'session_capability'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX session_consents_session_scope_created_at_idx
  ON public.session_consents (session_id, scope, created_at);
CREATE INDEX session_consents_session_created_at_idx
  ON public.session_consents (session_id, created_at);

ALTER TABLE public.session_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.session_consents FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.session_consents FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.session_consents FROM authenticated;
  END IF;
END
$$;
