ALTER TABLE leads ADD COLUMN IF NOT EXISTS reference_links jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS reference_files jsonb;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS reference_links jsonb;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS reference_files jsonb;