-- ===== MIGRATION 002: Style Bank + Referral System =====

-- ===== STYLE EXAMPLES (Style Bank) =====
-- Stores approved content snippets used as few-shot examples for AI generation
CREATE TABLE IF NOT EXISTS style_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('post', 'carousel', 'reels', 'stories', 'live', 'webinar', 'email')),
  title TEXT,
  body_text TEXT NOT NULL,
  warmup_phase TEXT CHECK (warmup_phase IN ('awareness', 'trust', 'desire', 'close')),
  performance_score INTEGER DEFAULT 0, -- 0-100, user can rate manually
  tags TEXT[],
  is_active BOOLEAN DEFAULT true,
  source_content_item_id UUID REFERENCES content_items(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON style_examples(project_id, is_active);

ALTER TABLE style_examples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own style examples" ON style_examples
  FOR ALL USING (EXISTS (SELECT 1 FROM projects WHERE id = project_id AND owner_id = auth.uid()));

-- ===== REFERRALS =====
-- Add referral_code to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro', 'agency')),
  ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bonus_days_earned INTEGER DEFAULT 0;

-- Index for fast referral code lookup
CREATE INDEX IF NOT EXISTS profiles_referral_code_idx ON profiles(referral_code);

-- Referrals tracking table
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID REFERENCES profiles(id) NOT NULL,
  referred_id UUID REFERENCES profiles(id) NOT NULL,
  referral_code TEXT NOT NULL,
  status TEXT DEFAULT 'registered' CHECK (status IN ('registered', 'active', 'rewarded', 'expired')),
  -- Reward tracking
  referrer_reward_type TEXT DEFAULT 'bonus_days' CHECK (referrer_reward_type IN ('bonus_days', 'cash', 'none')),
  referrer_reward_value INTEGER DEFAULT 30, -- 30 days bonus
  referrer_reward_given BOOLEAN DEFAULT false,
  referred_discount_percent INTEGER DEFAULT 20, -- 20% discount for referred user
  -- Attribution
  utm_source TEXT,
  utm_medium TEXT,
  ip_address TEXT,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  activated_at TIMESTAMPTZ, -- when referred user became paying
  rewarded_at TIMESTAMPTZ,
  UNIQUE(referred_id) -- one referrer per user
);

CREATE INDEX IF NOT EXISTS referrals_referrer_id_idx ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS referrals_code_idx ON referrals(referral_code);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- Referrers can see their own referrals
CREATE POLICY "Referrers can view own referrals" ON referrals
  FOR SELECT USING (auth.uid() = referrer_id);

-- System can insert referrals (via service role)
CREATE POLICY "System can insert referrals" ON referrals
  FOR INSERT WITH CHECK (true);

-- Admin can view all
CREATE POLICY "Admin can manage all referrals" ON referrals
  FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ===== GENERATE REFERRAL CODE FUNCTION =====
CREATE OR REPLACE FUNCTION generate_referral_code(user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  code TEXT;
  exists BOOLEAN;
BEGIN
  LOOP
    -- Generate 8-char alphanumeric code
    code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    SELECT EXISTS(SELECT 1 FROM profiles WHERE referral_code = code) INTO exists;
    EXIT WHEN NOT exists;
  END LOOP;

  UPDATE profiles SET referral_code = code WHERE id = user_id;
  RETURN code;
END;
$$;

-- ===== AUTO-GENERATE REFERRAL CODES =====
-- Trigger to auto-create referral code for new users
CREATE OR REPLACE FUNCTION auto_generate_referral_code()
RETURNS TRIGGER AS $$
DECLARE
  code TEXT;
  exists BOOLEAN;
BEGIN
  IF NEW.referral_code IS NULL THEN
    LOOP
      code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      SELECT EXISTS(SELECT 1 FROM profiles WHERE referral_code = code) INTO exists;
      EXIT WHEN NOT exists;
    END LOOP;
    NEW.referral_code := code;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_auto_referral_code
  BEFORE INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION auto_generate_referral_code();

-- Backfill existing users without referral codes
DO $$
DECLARE
  user_rec RECORD;
  code TEXT;
  exists BOOLEAN;
BEGIN
  FOR user_rec IN SELECT id FROM profiles WHERE referral_code IS NULL LOOP
    LOOP
      code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      SELECT EXISTS(SELECT 1 FROM profiles WHERE referral_code = code) INTO exists;
      EXIT WHEN NOT exists;
    END LOOP;
    UPDATE profiles SET referral_code = code WHERE id = user_rec.id;
  END LOOP;
END;
$$;

-- ===== FIX KNOWLEDGE VAULT RLS =====
-- Knowledge chunks should only be readable by authenticated users (for RAG)
-- Knowledge vault items only by admin (already done in migration 001, but ensure)
DROP POLICY IF EXISTS "Authenticated can read knowledge chunks" ON knowledge_chunks;
CREATE POLICY "Authenticated can read knowledge chunks" ON knowledge_chunks
  FOR SELECT USING (
    auth.role() = 'authenticated' AND
    EXISTS (
      SELECT 1 FROM knowledge_vault kv
      WHERE kv.id = vault_id AND kv.processing_status = 'ready'
    )
  );

-- ===== UPDATED MATCH FUNCTIONS WITH OPTIMIZED THRESHOLDS =====
CREATE OR REPLACE FUNCTION match_knowledge_chunks(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.78,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  chunk_text TEXT,
  metadata JSONB,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kc.id,
    kc.chunk_text,
    kc.metadata,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM knowledge_chunks kc
  JOIN knowledge_vault kv ON kc.vault_id = kv.id
  WHERE kv.processing_status = 'ready'
    AND 1 - (kc.embedding <=> query_embedding) > match_threshold
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION match_project_chunks(
  query_embedding vector(1536),
  project_id UUID,
  match_threshold float DEFAULT 0.72,
  match_count int DEFAULT 12
)
RETURNS TABLE (
  id UUID,
  chunk_text TEXT,
  material_type TEXT,
  metadata JSONB,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pc.id,
    pc.chunk_text,
    pm.material_type,
    pc.metadata,
    1 - (pc.embedding <=> query_embedding) AS similarity
  FROM project_chunks pc
  JOIN project_materials pm ON pc.material_id = pm.id
  WHERE pc.project_id = match_project_chunks.project_id
    AND pm.processing_status = 'ready'
    AND 1 - (pc.embedding <=> query_embedding) > match_threshold
  ORDER BY pc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ===== REFERRAL STATS VIEW =====
CREATE OR REPLACE VIEW referral_stats AS
SELECT
  p.id as user_id,
  p.referral_code,
  COUNT(r.id) as total_referrals,
  COUNT(CASE WHEN r.status IN ('active', 'rewarded') THEN 1 END) as active_referrals,
  COUNT(CASE WHEN r.referrer_reward_given = true THEN 1 END) as rewards_earned,
  COALESCE(SUM(CASE WHEN r.referrer_reward_given THEN r.referrer_reward_value ELSE 0 END), 0) as total_bonus_days
FROM profiles p
LEFT JOIN referrals r ON r.referrer_id = p.id
GROUP BY p.id, p.referral_code;

-- RLS on view - users see own stats only
-- (Views inherit policies from underlying tables in most cases)
