-- Recover legacy session-prefixed objects whose metadata was removed with the
-- session before a cleanup worker could delete the private object.
DO $$
BEGIN
  DELETE FROM public.private_attachment_cleanup c
  WHERE c.bucket = 'temporary-attachments'
    AND c.object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    AND NOT EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id::text = split_part(c.object_key, '/', 1)
    );

  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE $sql$
      DELETE FROM storage.objects o
      WHERE o.bucket_id = 'temporary-attachments'
        AND o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
        AND NOT EXISTS (
          SELECT 1 FROM public.sessions s
          WHERE s.id::text = split_part(o.name, '/', 1)
        )
    $sql$;
  END IF;
END $$;
