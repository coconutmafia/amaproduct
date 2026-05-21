-- Add material types that the code already writes but the CHECK constraint
-- rejected: my_instagram (own IG account analysis) and additional (the
-- "Дополнительные материалы" upload option). Without this, those inserts
-- throw project_materials_material_type_check violations.
ALTER TABLE project_materials DROP CONSTRAINT IF EXISTS project_materials_material_type_check;

ALTER TABLE project_materials ADD CONSTRAINT project_materials_material_type_check
  CHECK (material_type IN (
    'audience_survey', 'interview_transcript', 'audience_research',
    'competitors', 'unpacking_map', 'meanings_map', 'cases_reviews',
    'marketing_strategy', 'marketing_tactics', 'tone_of_voice',
    'funnel_description', 'chatbot_description', 'product_description',
    'content_reference', 'social_content', 'other',
    'blog_lines',
    'my_instagram', 'additional'
  ));
