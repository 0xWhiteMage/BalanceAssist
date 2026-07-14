-- Private object storage is optional in plain PostgreSQL test environments.
-- The application remains fail-closed until SUPABASE_PRIVATE_UPLOAD_BUCKET names this bucket.
ALTER TABLE public.uploaded_files
  ADD COLUMN IF NOT EXISTS object_key text,
  ADD COLUMN IF NOT EXISTS checksum_sha256 text,
  ADD COLUMN IF NOT EXISTS retention_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

UPDATE public.uploaded_files SET status = 'suppressed' WHERE status = 'quarantined';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uploaded_files_status_check') THEN
    ALTER TABLE public.uploaded_files
      ADD CONSTRAINT uploaded_files_status_check
      CHECK (status IS NULL OR status IN ('stored', 'pending_delivery', 'sent', 'suppressed', 'failed', 'expired')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uploaded_files_stored_metadata_check') THEN
    ALTER TABLE public.uploaded_files
      ADD CONSTRAINT uploaded_files_stored_metadata_check
      CHECK (status <> 'stored' OR (object_key IS NOT NULL AND checksum_sha256 ~ '^[0-9a-f]{64}$' AND retention_expires_at IS NOT NULL AND idempotency_key IS NOT NULL)) NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uploaded_files_idempotency_key_idx
  ON public.uploaded_files (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uploaded_files_object_key_idx
  ON public.uploaded_files (object_key) WHERE object_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS uploaded_files_stored_expiry_idx
  ON public.uploaded_files (retention_expires_at) WHERE status = 'stored';

ALTER TABLE public.uploaded_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.uploaded_files FROM PUBLIC;
