-- Trust security foundation: session capabilities, consent tracking, and draft versioning.
-- Requires: 000_full_schema.sql

-- Session authorization: capability hash and expiry
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS capability_hash text,
  ADD COLUMN IF NOT EXISTS capability_expires_at timestamptz;

-- Consent tracking
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS consent_version text,
  ADD COLUMN IF NOT EXISTS consented_at timestamptz;

-- Canonical draft state (server-owned)
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS draft jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS draft_version integer NOT NULL DEFAULT 0;

-- Replay protection for Telegram webhooks
CREATE TABLE IF NOT EXISTS public.processed_telegram_updates (
  update_id bigint PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- Index for cleanup of old entries
CREATE INDEX IF NOT EXISTS processed_telegram_updates_received_at_idx
  ON public.processed_telegram_updates (received_at DESC);

-- Idempotency for lead finalization
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS idempotency_key text UNIQUE;
