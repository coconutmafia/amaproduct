-- 015_brand_kit.sql — per-project BRAND KIT for the visual-content engine.
-- Lets every project carry its own style (colours / font / logo / background),
-- so carousels, posts and stories render in THAT creator's brand — not one
-- central default. Values are populated from: AI analysis of uploaded style
-- samples, the project's Instagram, or manual edits. All columns are additive
-- and nullable → safe to apply on the live DB.

alter table projects
  add column if not exists brand_handle       text,                      -- @handle shown on slides
  add column if not exists brand_accent_color text,                      -- hex, e.g. #EC1E8C
  add column if not exists brand_bg_color     text,                      -- hex background
  add column if not exists brand_bg_style     text                       -- paper | solid | gradient
       check (brand_bg_style is null or brand_bg_style in ('paper','solid','gradient')),
  add column if not exists brand_text_color   text,                      -- hex primary text
  add column if not exists brand_font_name    text,                      -- named font (free/Google, has Cyrillic)
  add column if not exists brand_font_url     text,                      -- uploaded custom font file (Storage path)
  add column if not exists brand_logo_url     text,                      -- uploaded logo (Storage path)
  add column if not exists brand_kit          jsonb,                     -- AI-extracted palette/mood/fonts + sample refs
  add column if not exists brand_kit_status   text not null default 'none'
       check (brand_kit_status in ('none','analyzing','ready'));

-- Public bucket for brand assets (logo, uploaded fonts, style samples).
-- Public so the image renderer (next/og) and previews can read them by URL.
-- Writes go through a server route using the service role (ownership checked in
-- code), so no per-row write policy is needed here.
insert into storage.buckets (id, name, public)
values ('project-brand', 'project-brand', true)
on conflict (id) do nothing;
