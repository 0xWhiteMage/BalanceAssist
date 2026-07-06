ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS telegram_file_id text;
ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS mime text;
ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS kind text;
