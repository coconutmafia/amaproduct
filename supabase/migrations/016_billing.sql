-- ===== MIGRATION 016: Billing v2 — approved tiers, trial lifecycle, providers =====
-- Aligns the DB with the APPROVED pricing (PRICING.md): Соло / Про / Продюсер.
-- Replaces the early free/starter/pro/agency model. Adds the trial lifecycle
-- (status + trial_ends_at) and payment-provider columns (Продамус / Stripe).
--
-- SAFE TO APPLY BEFORE PAYMENT IS LIVE:
--   * Enforcement is OFF in code until env BILLING_ENFORCED='true' — applying this
--     migration does NOT lock anyone out. It only re-labels tiers, gives everyone a
--     fresh 2-month trial, and adds columns the payment integration will fill later.
--   * No real paying users exist yet, so all rows are normalized to 'trial'.
-- Idempotent: re-running is safe.

-- ────────────────────────────────────────────────
-- 1. TIERS — free/starter/pro/agency → trial/solo/pro/producer
-- ────────────────────────────────────────────────

-- Drop the old constraint first so the UPDATE below can rewrite values freely.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_subscription_tier_check;

-- Pre-billing: nobody is actually paying, so everyone starts on a clean trial.
-- (Old 'pro'/'agency' were the early $49/$129 tiers — NOT the new $149/$299 ones,
--  so we must NOT silently grant them. Reset all to trial; admins bypass via role.)
UPDATE profiles SET subscription_tier = 'trial';

ALTER TABLE profiles
  ADD CONSTRAINT profiles_subscription_tier_check
  CHECK (subscription_tier IN ('trial', 'solo', 'pro', 'producer'));

ALTER TABLE profiles ALTER COLUMN subscription_tier SET DEFAULT 'trial';

-- ────────────────────────────────────────────────
-- 2. SUBSCRIPTION LIFECYCLE + PROVIDER COLUMNS
-- ────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS subscription_status      TEXT NOT NULL DEFAULT 'trialing',
  ADD COLUMN IF NOT EXISTS trial_ends_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_period_end       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_provider         TEXT,   -- 'prodamus' | 'stripe'
  ADD COLUMN IF NOT EXISTS provider_customer_id     TEXT,
  ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_subscription_status_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_subscription_status_check
  CHECK (subscription_status IN ('trialing','active','past_due','view_only','paused','canceled'));

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_payment_provider_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_payment_provider_check
  CHECK (payment_provider IS NULL OR payment_provider IN ('prodamus','stripe'));

-- Give every existing user a fresh 2-month trial from now (no lockouts, clean start).
UPDATE profiles
  SET subscription_status = 'trialing',
      trial_ends_at = COALESCE(trial_ends_at, NOW() + INTERVAL '60 days')
  WHERE trial_ends_at IS NULL;

CREATE INDEX IF NOT EXISTS profiles_trial_ends_at_idx ON profiles(trial_ends_at)
  WHERE subscription_status = 'trialing';
CREATE INDEX IF NOT EXISTS profiles_provider_sub_idx ON profiles(provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

-- ────────────────────────────────────────────────
-- 3. GENERATION LIMITS — new tiers
-- ────────────────────────────────────────────────
-- Соло/trial: ~300 content units/mo (a full warmup + regular posting with room
-- to iterate — the "golden middle": enough to do the job, not enough to get
-- Про-level volume for Соло money). Про/Продюсер: "unlimited (fair use)" — the
-- number here is an anti-abuse ceiling no normal user reaches (Про expected ~500,
-- Продюсер ~1800 across 10 clients).
CREATE OR REPLACE FUNCTION generation_limit(plan TEXT)
RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  RETURN CASE plan
    WHEN 'trial'    THEN 300
    WHEN 'solo'     THEN 300
    WHEN 'pro'      THEN 2000   -- fair-use ceiling
    WHEN 'producer' THEN 8000   -- fair-use ceiling
    ELSE 300
  END;
END;
$$;

-- consume_generation() and add_bonus_generations() from migration 003 are reused
-- as-is (atomic, monthly reset). No change needed — they read generation_limit().
