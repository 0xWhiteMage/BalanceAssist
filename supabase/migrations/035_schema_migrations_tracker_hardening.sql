-- Databases that recorded 018 before tracker hardening need this forward fix.
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version text PRIMARY KEY,
  filename text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations FROM authenticated;
  END IF;
END
$$;
