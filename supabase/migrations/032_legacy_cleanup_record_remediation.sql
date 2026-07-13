-- Records left behind when their session was deleted still contain the old
-- session-prefixed name. Delete the storage object first, then remove the
-- linkable recovery row in the same migration transaction.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DELETE FROM storage.objects o
    USING public.private_attachment_cleanup c
    WHERE o.bucket_id = c.bucket
      AND o.name = c.object_key
      AND c.object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/';
  END IF;

  DELETE FROM public.private_attachment_cleanup
  WHERE object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/';
END $$;
