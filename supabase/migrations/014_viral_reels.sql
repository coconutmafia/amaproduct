-- Viral reel references: real залетевшие reels analysed (transcript + why it
-- worked) and woven into content plans. Two scopes:
--   system  — added by admin, applied to all users with matching niche
--   project — added by a user for their own project only
create table if not exists viral_reels (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null default 'project' check (scope in ('system','project')),
  project_id  uuid references projects(id) on delete cascade,  -- set when scope='project'
  created_by  uuid references auth.users(id) on delete set null,
  source_url  text not null,
  username    text,                 -- author handle
  caption     text,
  transcript  text,                 -- Whisper transcription of the reel audio
  analysis    text,                 -- AI: hook / structure / why it worked
  reel_type   text,                 -- short label, e.g. "хук-перевёртыш"
  niches      text[],               -- for system reels; null/empty = all niches
  views       bigint,
  likes       bigint,
  comments    bigint,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists viral_reels_scope_idx   on viral_reels (scope, is_active, created_at desc);
create index if not exists viral_reels_project_idx on viral_reels (project_id);

alter table viral_reels enable row level security;

-- Read: anyone authenticated can read active SYSTEM reels (generator needs them);
-- a user can read their own PROJECT reels (projects they own).
drop policy if exists viral_reels_read on viral_reels;
create policy viral_reels_read on viral_reels
  for select to authenticated
  using (
    (scope = 'system' and is_active = true)
    or (scope = 'project' and exists (
      select 1 from projects p where p.id = viral_reels.project_id and p.owner_id = auth.uid()
    ))
    or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin')
  );

-- Write SYSTEM reels: admins only.
drop policy if exists viral_reels_system_write on viral_reels;
create policy viral_reels_system_write on viral_reels
  for all to authenticated
  using (scope = 'system' and exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin'))
  with check (scope = 'system' and exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin'));

-- Write PROJECT reels: the project owner.
drop policy if exists viral_reels_project_write on viral_reels;
create policy viral_reels_project_write on viral_reels
  for all to authenticated
  using (scope = 'project' and exists (
    select 1 from projects p where p.id = viral_reels.project_id and p.owner_id = auth.uid()
  ))
  with check (scope = 'project' and exists (
    select 1 from projects p where p.id = viral_reels.project_id and p.owner_id = auth.uid()
  ));
