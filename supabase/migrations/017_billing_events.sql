-- ===== MIGRATION 017: Billing webhook idempotency log =====
-- Stores processed payment-provider event IDs so a re-delivered webhook (Stripe
-- retries, Продамус callbacks) is applied exactly once. Written only by the
-- service-role (admin) client from the webhook route — RLS on with NO policies
-- means normal users can't read or write it.

CREATE TABLE IF NOT EXISTS billing_events (
  id         TEXT PRIMARY KEY,          -- provider event id (Stripe: evt_…)
  provider   TEXT NOT NULL,             -- 'stripe' | 'prodamus'
  type       TEXT,                      -- event type, for debugging
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
-- (no policies → only the service role bypasses RLS)
