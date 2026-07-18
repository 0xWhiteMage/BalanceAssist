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
