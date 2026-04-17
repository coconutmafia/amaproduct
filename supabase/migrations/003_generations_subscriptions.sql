-- ===== MIGRATION 003: Generation-based Subscriptions + 2-Level Referrals =====

-- ────────────────────────────────────────────────
-- 1. PROFILES — switch from days to generations
-- ────────────────────────────────────────────────

-- Drop old column, add new ones
ALTER TABLE profiles
  DROP COLUMN IF EXISTS bonus_days_earned;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bonus_generations    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS generations_used     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS generations_reset_at TIMESTAMPTZ NOT NULL DEFAULT (date_trunc('month', NOW()) + INTERVAL '1 month');

-- Update subscription_tier constraint to include 'starter'
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_subscription_tier_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_subscription_tier_check
  CHECK (subscription_tier IN ('free', 'starter', 'pro', 'agency'));

-- Default tier for existing rows
UPDATE profiles SET subscription_tier = 'free' WHERE subscription_tier IS NULL;

-- ────────────────────────────────────────────────
-- 2. REFERRALS — generation-based rewards, 2 levels
-- ────────────────────────────────────────────────

-- Drop old reward columns
ALTER TABLE referrals
  DROP COLUMN IF EXISTS referrer_reward_type,
  DROP COLUMN IF EXISTS referrer_reward_value,
  DROP COLUMN IF EXISTS referrer_reward_given,
  DROP COLUMN IF EXISTS referred_discount_percent,
  DROP COLUMN IF EXISTS utm_source,
  DROP COLUMN IF EXISTS utm_medium,
  DROP COLUMN IF EXISTS ip_address,
  DROP COLUMN IF EXISTS activated_at,
  DROP COLUMN IF EXISTS rewarded_at;

-- Add new columns
ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS level              INTEGER NOT NULL DEFAULT 1 CHECK (level IN (1, 2)),
  ADD COLUMN IF NOT EXISTS signup_bonus_given  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_bonus_given BOOLEAN NOT NULL DEFAULT false;

-- Update status constraint
ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_status_check;
ALTER TABLE referrals
  ADD CONSTRAINT referrals_status_check
  CHECK (status IN ('registered', 'paid', 'expired'));

-- ────────────────────────────────────────────────
-- 3. GENERATION LIMITS FUNCTION
-- ────────────────────────────────────────────────

-- Returns monthly limit for a given plan
CREATE OR REPLACE FUNCTION generation_limit(plan TEXT)
RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  RETURN CASE plan
    WHEN 'starter' THEN 80
    WHEN 'pro'     THEN 250
    WHEN 'agency'  THEN 800
    ELSE 5  -- free
  END;
END;
$$;

-- Check and consume one generation (returns true if allowed)
CREATE OR REPLACE FUNCTION consume_generation(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile        RECORD;
  v_monthly_limit  INTEGER;
  v_now            TIMESTAMPTZ := NOW();
BEGIN
  SELECT subscription_tier, generations_used, bonus_generations, generations_reset_at
  INTO v_profile
  FROM profiles WHERE id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN RETURN FALSE; END IF;

  -- Reset monthly counter if period expired
  IF v_now >= v_profile.generations_reset_at THEN
    UPDATE profiles SET
      generations_used = 0,
      generations_reset_at = date_trunc('month', v_now) + INTERVAL '1 month'
    WHERE id = p_user_id;
    v_profile.generations_used := 0;
  END IF;

  v_monthly_limit := generation_limit(v_profile.subscription_tier);

  -- Has monthly quota remaining?
  IF v_profile.generations_used < v_monthly_limit THEN
    UPDATE profiles SET generations_used = generations_used + 1 WHERE id = p_user_id;
    RETURN TRUE;
  END IF;

  -- Has bonus generations?
  IF v_profile.bonus_generations > 0 THEN
    UPDATE profiles SET bonus_generations = bonus_generations - 1 WHERE id = p_user_id;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- ────────────────────────────────────────────────
-- 4. REFERRAL BONUS FUNCTION
-- ────────────────────────────────────────────────

-- Add bonus generations to a user
CREATE OR REPLACE FUNCTION add_bonus_generations(p_user_id UUID, p_amount INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles
  SET bonus_generations = bonus_generations + p_amount
  WHERE id = p_user_id;
END;
$$;

-- ────────────────────────────────────────────────
-- 5. REFERRAL STATS VIEW — updated
-- ────────────────────────────────────────────────

DROP VIEW IF EXISTS referral_stats;
CREATE OR REPLACE VIEW referral_stats AS
SELECT
  p.id                                                          AS user_id,
  p.referral_code,
  p.subscription_tier,
  p.bonus_generations,
  p.generations_used,
  p.generations_reset_at,
  generation_limit(p.subscription_tier)                         AS monthly_limit,
  COUNT(r.id)                                                   AS total_referrals,
  COUNT(r.id) FILTER (WHERE r.level = 1)                        AS level1_referrals,
  COUNT(r.id) FILTER (WHERE r.level = 2)                        AS level2_referrals,
  COUNT(r.id) FILTER (WHERE r.status = 'paid')                  AS paid_referrals,
  COUNT(r.id) FILTER (WHERE r.signup_bonus_given  = true)       AS signup_bonuses_given,
  COUNT(r.id) FILTER (WHERE r.payment_bonus_given = true)       AS payment_bonuses_given,
  -- total bonus gens earned from referrals
  COALESCE(
    SUM(CASE WHEN r.signup_bonus_given  AND r.level = 1 THEN 10
             WHEN r.signup_bonus_given  AND r.level = 2 THEN 5  ELSE 0 END) +
    SUM(CASE WHEN r.payment_bonus_given AND r.level = 1 THEN 25
             WHEN r.payment_bonus_given AND r.level = 2 THEN 12 ELSE 0 END),
    0
  )                                                             AS total_gens_earned
FROM profiles p
LEFT JOIN referrals r ON r.referrer_id = p.id
GROUP BY p.id, p.referral_code, p.subscription_tier, p.bonus_generations,
         p.generations_used, p.generations_reset_at;

-- Grant read to authenticated users (own row)
GRANT SELECT ON referral_stats TO authenticated;
