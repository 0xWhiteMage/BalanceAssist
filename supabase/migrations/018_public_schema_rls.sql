-- Deny browser/API-key access to application data. Server routes use the service role.
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.human_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uploaded_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_telegram_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handoff_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public.sessions,
  public.events,
  public.leads,
  public.human_messages,
  public.uploaded_files,
  public.reference_links,
  public.processed_telegram_updates,
  public.handoff_outbox,
  public.schema_migrations
FROM PUBLIC;

-- Supabase provides these roles; plain PostgreSQL test services may not.
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
      public.handoff_outbox,
      public.schema_migrations
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
      public.handoff_outbox,
      public.schema_migrations
    FROM authenticated;
  END IF;
END
$$;
