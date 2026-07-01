-- Allow material_type = 'voice_rules'.
--
-- The «правила голоса» feature (app/api/voice-rules → lib/supabase/upsertMaterial)
-- writes project_materials rows with material_type='voice_rules', but the CHECK
-- constraint (last set in 012) never listed it. First save for any project did an
-- INSERT that Postgres rejected with project_materials_material_type_check → the
-- route returned 500 and the standing voice rules never reached generation
-- (rag.ts reads voice_rules as a dedicated top-of-prompt block). This was never
-- a regression — the feature (commit 9752099) landed after the constraint (012)
-- with no accompanying migration.
--
-- Full fix: extend the allowed list (do NOT drop the constraint) so bad
-- material_type values are still rejected. List = the exact 012 set + voice_rules.
ALTER TABLE project_materials DROP CONSTRAINT IF EXISTS project_materials_material_type_check;

ALTER TABLE project_materials ADD CONSTRAINT project_materials_material_type_check
  CHECK (material_type IN (
    'audience_survey', 'interview_transcript', 'audience_research',
    'competitors', 'unpacking_map', 'meanings_map', 'cases_reviews',
    'marketing_strategy', 'marketing_tactics', 'tone_of_voice',
    'funnel_description', 'chatbot_description', 'product_description',
    'content_reference', 'social_content', 'other',
    'blog_lines',
    'my_instagram', 'additional',
    'voice_rules'
  ));
