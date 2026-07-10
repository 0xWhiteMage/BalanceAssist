-- Relax legacy Supabase Storage columns that are no longer used by the Telegram-based upload flow.
-- The upload route inserts telegram_file_id/name/mime/kind but NOT storage_path/original_name.

ALTER TABLE uploaded_files ALTER COLUMN storage_path DROP NOT NULL;
ALTER TABLE uploaded_files ALTER COLUMN original_name DROP NOT NULL;
