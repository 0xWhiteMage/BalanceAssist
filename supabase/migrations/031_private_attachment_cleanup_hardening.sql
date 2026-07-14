-- Legacy clients used session-prefixed paths. Retain their metadata only as an
-- explicit deletion obligation; the authenticated worker removes object then row.
ALTER TABLE public.uploaded_files
  ADD COLUMN IF NOT EXISTS cleanup_required_at timestamptz;

UPDATE public.uploaded_files
SET cleanup_required_at = coalesce(cleanup_required_at, now())
WHERE object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/';

-- Old recovery rows encode the session in object_key. Move recoverable entries
-- into the guarded metadata cleanup path, then remove that linkable record.
INSERT INTO public.uploaded_files (
  session_id, storage_path, original_name, mime_type, size_bytes, object_key,
  checksum_sha256, retention_expires_at, idempotency_key, status, cleanup_required_at
)
SELECT s.id, c.object_key, '[redacted]', null, 0, c.object_key,
       c.checksum_sha256, c.retention_expires_at, gen_random_uuid(), 'stored', now()
FROM public.private_attachment_cleanup c
JOIN public.sessions s ON s.id = substring(c.object_key FROM 1 FOR 36)::uuid
WHERE c.object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
ON CONFLICT (object_key) WHERE object_key IS NOT NULL DO UPDATE
SET cleanup_required_at = coalesce(public.uploaded_files.cleanup_required_at, now());

DELETE FROM public.private_attachment_cleanup c
USING public.uploaded_files u
WHERE c.object_key = u.object_key
  AND u.cleanup_required_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS uploaded_files_cleanup_required_idx
  ON public.uploaded_files (retention_expires_at)
  WHERE cleanup_required_at IS NOT NULL;

INSERT INTO public.private_attachment_storage_readiness (bucket, status)
VALUES ('temporary-attachments', 'unavailable')
ON CONFLICT (bucket) DO UPDATE SET status = EXCLUDED.status;
