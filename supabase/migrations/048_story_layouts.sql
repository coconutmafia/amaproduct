-- Сохранённые оформления свободного редактора (Марина 06.09: «кнопку
-- «сохранить оформление», чтобы потом возвращаться и редактировать, а не
-- начинать сначала каждый раз»). Хранит раскладку слайда (design = SlideValue
-- редактора) и, если был экспорт, превью PNG. Владелец = автор.
-- Идемпотентна.
create table if not exists story_layouts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  project_id  uuid references projects(id) on delete cascade,
  title       text not null,
  format      text not null default 'story',
  design      jsonb not null,
  preview_url text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists story_layouts_project_idx on story_layouts (project_id, created_at desc);

alter table story_layouts enable row level security;
drop policy if exists story_layouts_owner on story_layouts;
create policy story_layouts_owner on story_layouts
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function touch_story_layouts_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists story_layouts_touch on story_layouts;
create trigger story_layouts_touch
  before update on story_layouts
  for each row execute function touch_story_layouts_updated_at();
