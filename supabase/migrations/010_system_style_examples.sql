-- System style examples: admin-loaded examples used as fallback for all projects
-- Allow project_id to be null (system-level examples have no project)
ALTER TABLE style_examples ALTER COLUMN project_id DROP NOT NULL;

-- Add is_system flag
ALTER TABLE style_examples ADD COLUMN IF NOT EXISTS is_system boolean DEFAULT false;

-- Index for fast lookup of system examples by content_type
CREATE INDEX IF NOT EXISTS style_examples_system_idx
  ON style_examples(is_system, content_type, performance_score DESC)
  WHERE is_system = true AND is_active = true;
