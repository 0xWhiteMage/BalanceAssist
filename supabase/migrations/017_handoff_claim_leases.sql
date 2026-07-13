ALTER TABLE handoff_outbox ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS handoff_outbox_claim_expires_at_idx
  ON handoff_outbox (claim_expires_at ASC);
