BEGIN;
SELECT pg_advisory_xact_lock(90442045);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.schema_migrations
    WHERE version = '043' AND filename = '043_deletion_state_batched_cleanup.sql'
  ) THEN
    RAISE EXCEPTION 'orphaned private attachment cleanup 045 baseline 043 is not recorded with its reviewed filename';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.schema_migrations
    WHERE version = '044' AND filename = '044_monday_crm_projection_tables.sql'
  ) THEN
    RAISE EXCEPTION 'orphaned private attachment cleanup 045 baseline 044 is not recorded with its reviewed filename';
  END IF;
  IF to_regclass('public.sessions') IS NULL
    OR to_regclass('public.private_attachment_cleanup') IS NULL
    OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'orphaned private attachment cleanup 045 baseline schema signatures are missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.schema_migrations
    WHERE version = '045' AND filename <> '045_orphaned_private_attachment_cleanup.sql'
  ) THEN
    RAISE EXCEPTION 'orphaned private attachment cleanup 045 is recorded with an unexpected filename';
  END IF;
END $$;

-- BEGIN 045 045_orphaned_private_attachment_cleanup.sql
-- Recover legacy session-prefixed objects whose metadata was removed with the
-- session before the Storage API cleanup worker could delete the private object.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO public.private_attachment_cleanup
        (object_key, bucket, checksum_sha256, retention_expires_at, status)
      SELECT o.name, o.bucket_id, repeat('0', 64), now(), 'pending_cleanup'
      FROM storage.objects o
      WHERE o.bucket_id = 'temporary-attachments'
        AND o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
        AND NOT EXISTS (
          SELECT 1 FROM public.sessions s
          WHERE s.id::text = split_part(o.name, '/', 1)
        )
      ON CONFLICT (object_key) DO NOTHING
    $sql$;
  END IF;
END $$;
-- END 045 045_orphaned_private_attachment_cleanup.sql

INSERT INTO public.schema_migrations (version, filename)
VALUES ('045', '045_orphaned_private_attachment_cleanup.sql')
ON CONFLICT (version) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.schema_migrations
    WHERE version = '045' AND filename = '045_orphaned_private_attachment_cleanup.sql'
  ) OR EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'temporary-attachments'
      AND o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
      AND NOT EXISTS (
        SELECT 1 FROM public.sessions s
        WHERE s.id::text = split_part(o.name, '/', 1)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.private_attachment_cleanup c
        WHERE c.object_key = o.name AND c.bucket = o.bucket_id
      )
  ) THEN
    RAISE EXCEPTION 'orphaned private attachment cleanup 045 verification failed';
  END IF;
END $$;

COMMIT;
