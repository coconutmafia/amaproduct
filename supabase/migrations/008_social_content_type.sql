-- Add social_content to material_type enum constraint
ALTER TABLE project_materials
  DROP CONSTRAINT IF EXISTS project_materials_material_type_check;

ALTER TABLE project_materials
  ADD CONSTRAINT project_materials_material_type_check
  CHECK (material_type IN (
    'audience_survey', 'interview_transcript', 'audience_research',
    'competitors', 'unpacking_map', 'meanings_map', 'cases_reviews',
    'marketing_strategy', 'marketing_tactics', 'tone_of_voice',
    'funnel_description', 'chatbot_description', 'product_description',
    'content_reference', 'social_content', 'other'
  ));
