-- ===== MIGRATION 005: AI Assistant Name + Extended Project Fields =====

-- AI assistant name per user (gamification)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS ai_assistant_name TEXT DEFAULT NULL;

-- Extended project fields for better AI context
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS target_audience   TEXT DEFAULT NULL,  -- описание ЦА
  ADD COLUMN IF NOT EXISTS content_goals     TEXT DEFAULT NULL,  -- цели контента
  ADD COLUMN IF NOT EXISTS launch_date       DATE DEFAULT NULL,  -- дата запуска
  ADD COLUMN IF NOT EXISTS launch_budget     NUMERIC DEFAULT NULL, -- бюджет запуска
  ADD COLUMN IF NOT EXISTS onboarding_done   BOOLEAN DEFAULT false; -- показать онбординг

-- Track whether a user has completed onboarding
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_done BOOLEAN NOT NULL DEFAULT false;
