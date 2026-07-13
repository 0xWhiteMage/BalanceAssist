ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS original_name text;
ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS mime_type text;
ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS storage_path text;
