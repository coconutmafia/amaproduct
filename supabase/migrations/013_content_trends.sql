-- Monthly content trends / "актуалочки" — curated by the service owner,
-- woven into every user's content plan by the generator. E.g. the "Yes/but"
-- reel format, seasonal hooks, trending structures.

create table if not exists content_trends (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,                 -- "Формат Yes/but"
  description text not null,                 -- что это и как использовать
  example     text,                          -- конкретный пример
  format_type text not null default 'any'    -- any | post | reels | stories | carousel
              check (format_type in ('any','post','reels','stories','carousel')),
  niches      text[],                        -- null/пусто = для всех ниш
  is_active   boolean not null default true,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists content_trends_active_idx
  on content_trends (is_active, created_at desc);

-- keep updated_at fresh
create or replace function touch_content_trends_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists content_trends_touch on content_trends;
create trigger content_trends_touch
  before update on content_trends
  for each row execute function touch_content_trends_updated_at();

-- RLS: any authenticated user can READ active trends (the generator needs
-- them); only admins can write. Admin = profiles.role = 'admin'.
alter table content_trends enable row level security;

drop policy if exists content_trends_read on content_trends;
create policy content_trends_read on content_trends
  for select to authenticated
  using (is_active = true or exists (
    select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'
  ));

drop policy if exists content_trends_admin_write on content_trends;
create policy content_trends_admin_write on content_trends
  for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
