-- Trust delivery outbox: durable handoff queue for producer notifications.
-- Requires: 014_trust_security_foundation.sql

CREATE TABLE IF NOT EXISTS public.handoff_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions (id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'claiming', 'sent', 'failed', 'escalated')),
  idempotency_key text UNIQUE NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS handoff_outbox_session_id_idx
  ON public.handoff_outbox (session_id);

CREATE INDEX IF NOT EXISTS handoff_outbox_state_idx
  ON public.handoff_outbox (state);

CREATE INDEX IF NOT EXISTS handoff_outbox_next_attempt_at_idx
  ON public.handoff_outbox (next_attempt_at ASC);

CREATE INDEX IF NOT EXISTS handoff_outbox_created_at_idx
  ON public.handoff_outbox (created_at DESC);
