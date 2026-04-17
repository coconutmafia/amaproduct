-- ===== MIGRATION 004: Admin Promo Codes =====

CREATE TABLE IF NOT EXISTS promo_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT UNIQUE NOT NULL,
  bonus_generations INTEGER NOT NULL DEFAULT 10,
  description     TEXT,                         -- e.g. "Для Пети на тест"
  max_uses        INTEGER DEFAULT NULL,          -- NULL = unlimited
  uses_count      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID REFERENCES profiles(id),
  expires_at      TIMESTAMPTZ DEFAULT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS promo_codes_code_idx ON promo_codes(code);

ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;

-- Only admins can manage promo codes
CREATE POLICY "Admin can manage promo codes" ON promo_codes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Authenticated users can read active codes (for validation)
CREATE POLICY "Authenticated can read active promo codes" ON promo_codes
  FOR SELECT USING (
    auth.role() = 'authenticated' AND is_active = true
  );

-- Track who used which promo code
CREATE TABLE IF NOT EXISTS promo_code_uses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_id     UUID REFERENCES promo_codes(id) ON DELETE CASCADE NOT NULL,
  user_id      UUID REFERENCES profiles(id) NOT NULL,
  used_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(promo_id, user_id)  -- one use per user per code
);

ALTER TABLE promo_code_uses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can view promo uses" ON promo_code_uses
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Users can insert own use" ON promo_code_uses
  FOR INSERT WITH CHECK (auth.uid() = user_id);
