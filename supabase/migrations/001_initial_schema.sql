-- ===== EXTENSIONS =====
CREATE EXTENSION IF NOT EXISTS vector;

-- ===== PROFILES =====
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('admin', 'producer', 'client')),
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== KNOWLEDGE VAULT (admin only) =====
CREATE TABLE knowledge_vault (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES profiles(id) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  content_type TEXT NOT NULL CHECK (content_type IN ('methodology', 'framework', 'example', 'template', 'tov_system')),
  raw_content TEXT,
  file_url TEXT,
  file_type TEXT,
  processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'ready', 'error')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id UUID REFERENCES knowledge_vault(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== PROJECTS =====
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES profiles(id) NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  niche TEXT,
  instagram_url TEXT,
  vk_url TEXT,
  telegram_url TEXT,
  youtube_url TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived', 'draft')),
  completeness_score INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== PROJECT MATERIALS =====
CREATE TABLE project_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  material_type TEXT NOT NULL CHECK (material_type IN (
    'audience_survey', 'interview_transcript', 'audience_research',
    'competitors', 'unpacking_map', 'meanings_map', 'cases_reviews',
    'marketing_strategy', 'marketing_tactics', 'tone_of_voice',
    'funnel_description', 'chatbot_description', 'product_description',
    'content_reference', 'other'
  )),
  title TEXT NOT NULL,
  raw_content TEXT,
  file_url TEXT,
  file_type TEXT,
  processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'ready', 'error')),
  parsed_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE project_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID REFERENCES project_materials(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== PRODUCTS =====
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL,
  currency TEXT DEFAULT 'RUB',
  product_type TEXT,
  sales_page_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== FUNNELS =====
CREATE TABLE funnels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  funnel_type TEXT,
  steps JSONB,
  chatbot_link TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== WARMUP PLANS =====
CREATE TABLE warmup_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  name TEXT NOT NULL,
  duration_days INTEGER NOT NULL,
  audience_type TEXT,
  funnel_id UUID REFERENCES funnels(id),
  events JSONB,
  use_cases BOOLEAN DEFAULT true,
  extra_hooks TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'active', 'completed')),
  strategic_summary TEXT,
  summary_approved BOOLEAN DEFAULT false,
  plan_data JSONB,
  ai_conversation JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== CONTENT PLANS =====
CREATE TABLE content_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  warmup_plan_id UUID REFERENCES warmup_plans(id),
  week_number INTEGER NOT NULL,
  start_date DATE,
  end_date DATE,
  status TEXT DEFAULT 'draft',
  plan_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== CONTENT ITEMS =====
CREATE TABLE content_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  content_plan_id UUID REFERENCES content_plans(id),
  warmup_plan_id UUID REFERENCES warmup_plans(id),
  content_type TEXT NOT NULL CHECK (content_type IN ('post', 'carousel', 'reels', 'stories', 'live', 'webinar', 'email')),
  title TEXT,
  day_number INTEGER,
  warmup_phase TEXT CHECK (warmup_phase IN ('awareness', 'trust', 'desire', 'close')),
  body_text TEXT,
  structured_data JSONB,
  cta TEXT,
  hashtags TEXT[],
  generation_prompt TEXT,
  version_number INTEGER DEFAULT 1,
  is_approved BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ,
  reach INTEGER,
  reactions INTEGER,
  saves INTEGER,
  performance_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== CONTENT VERSIONS =====
CREATE TABLE content_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id UUID REFERENCES content_items(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  body_text TEXT,
  structured_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== AI CONVERSATIONS =====
CREATE TABLE ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  conversation_type TEXT,
  messages JSONB NOT NULL DEFAULT '[]',
  context_used JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== INDEXES =====
CREATE INDEX ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX ON project_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX ON projects(owner_id);
CREATE INDEX ON project_materials(project_id);
CREATE INDEX ON content_items(project_id);
CREATE INDEX ON warmup_plans(project_id);

-- ===== ROW LEVEL SECURITY =====
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnels ENABLE ROW LEVEL SECURITY;
ALTER TABLE warmup_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_chunks ENABLE ROW LEVEL SECURITY;

-- Profiles: own only
CREATE POLICY "Users can manage own profile" ON profiles FOR ALL USING (auth.uid() = id);

-- Projects: own only
CREATE POLICY "Users can manage own projects" ON projects FOR ALL USING (auth.uid() = owner_id);

-- Project materials: via project ownership
CREATE POLICY "Users can manage own project materials" ON project_materials
  FOR ALL USING (EXISTS (SELECT 1 FROM projects WHERE id = project_id AND owner_id = auth.uid()));

-- Products, funnels: via project ownership
CREATE POLICY "Users can manage own products" ON products
  FOR ALL USING (EXISTS (SELECT 1 FROM projects WHERE id = project_id AND owner_id = auth.uid()));

CREATE POLICY "Users can manage own funnels" ON funnels
  FOR ALL USING (EXISTS (SELECT 1 FROM projects WHERE id = project_id AND owner_id = auth.uid()));

-- Warmup plans
CREATE POLICY "Users can manage own warmup plans" ON warmup_plans
  FOR ALL USING (EXISTS (SELECT 1 FROM projects WHERE id = project_id AND owner_id = auth.uid()));

-- Content
CREATE POLICY "Users can manage own content plans" ON content_plans
  FOR ALL USING (EXISTS (SELECT 1 FROM projects WHERE id = project_id AND owner_id = auth.uid()));

CREATE POLICY "Users can manage own content items" ON content_items
  FOR ALL USING (EXISTS (SELECT 1 FROM projects WHERE id = project_id AND owner_id = auth.uid()));

CREATE POLICY "Users can manage own content versions" ON content_versions
  FOR ALL USING (EXISTS (
    SELECT 1 FROM content_items ci JOIN projects p ON ci.project_id = p.id
    WHERE ci.id = content_item_id AND p.owner_id = auth.uid()
  ));

-- AI conversations
CREATE POLICY "Users can manage own ai conversations" ON ai_conversations
  FOR ALL USING (EXISTS (SELECT 1 FROM projects WHERE id = project_id AND owner_id = auth.uid()));

-- Knowledge vault: admin only
CREATE POLICY "Admin manages knowledge vault" ON knowledge_vault
  FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Knowledge chunks: readable by all authenticated (for RAG)
CREATE POLICY "Authenticated can read knowledge chunks" ON knowledge_chunks
  FOR SELECT USING (auth.role() = 'authenticated');

-- Project chunks: own projects only
CREATE POLICY "Users can manage own project chunks" ON project_chunks
  FOR ALL USING (EXISTS (SELECT 1 FROM projects WHERE id = project_id AND owner_id = auth.uid()));

-- ===== FUNCTIONS FOR RAG SEARCH =====
CREATE OR REPLACE FUNCTION match_knowledge_chunks(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
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
  match_threshold float DEFAULT 0.65,
  match_count int DEFAULT 10
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

-- ===== TRIGGERS =====
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    CASE WHEN NEW.email = current_setting('app.admin_email', true) THEN 'admin' ELSE 'client' END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER warmup_plans_updated_at BEFORE UPDATE ON warmup_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER content_items_updated_at BEFORE UPDATE ON content_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
