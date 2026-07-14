-- Deny browser/API-key access to application data. Server routes use the service role.
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.human_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uploaded_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_telegram_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handoff_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public.sessions,
  public.events,
  public.leads,
  public.human_messages,
  public.uploaded_files,
  public.reference_links,
  public.processed_telegram_updates,
  public.handoff_outbox
FROM PUBLIC;

-- Supabase provides these roles; plain PostgreSQL test services may not.
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version text PRIMARY KEY,
  filename text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE
      public.sessions,
      public.events,
      public.leads,
      public.human_messages,
      public.uploaded_files,
      public.reference_links,
      public.processed_telegram_updates,
      public.handoff_outbox
    FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE
      public.sessions,
      public.events,
      public.leads,
      public.human_messages,
      public.uploaded_files,
      public.reference_links,
      public.processed_telegram_updates,
      public.handoff_outbox
    FROM authenticated;
  END IF;

  -- Supabase CLI can run project migrations before the custom migration
  -- runner creates its public tracker table.
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
    REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations FROM PUBLIC;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations FROM anon;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations FROM authenticated;
    END IF;
  END IF;
END
$$;
