-- Fix content_trends: the table (013) was created WITHOUT the `scope` and
-- `project_id` columns, yet the entire codebase filters on them
-- (generate-week-brief, warmup-plan, generate, suggest-angles, suggest-trends,
-- admin/trends, cron/refresh-trends, projects/[id]/trends). Every such SELECT/
-- INSERT hit "column ... does not exist" and was swallowed by try/catch → trends
-- silently never reached generation, and users could not save their own trends.
-- Never a regression: the feature (013 + 0c61087) shipped with this gap.
--
-- Two fixes here:
--   1. Add the missing columns + indexes (idempotent — safe whether or not the
--      prod DB already got them added by hand).
--   2. RLS parity with viral_reels (014): a project owner can read/write their
--      own project trends; admins own the system trends; project trends no longer
--      leak across users (the old read policy exposed every active row).

-- 1 ── columns ──────────────────────────────────────────────────────────────
-- Existing rows were admin-curated system trends → default 'system'.
alter table content_trends
  add column if not exists scope text not null default 'system'
      check (scope in ('system','project'));
alter table content_trends
  add column if not exists project_id uuid references projects(id) on delete cascade;

create index if not exists content_trends_scope_idx
  on content_trends (scope, is_active, created_at desc);
create index if not exists content_trends_project_idx
  on content_trends (project_id);

-- 2 ── RLS (mirror viral_reels) ─────────────────────────────────────────────
-- Read: active SYSTEM trends for everyone; a user's OWN project trends; admin all.
drop policy if exists content_trends_read on content_trends;
create policy content_trends_read on content_trends
  for select to authenticated
  using (
    (scope = 'system' and is_active = true)
    or (scope = 'project' and exists (
      select 1 from projects p where p.id = content_trends.project_id and p.owner_id = auth.uid()
    ))
    or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin')
  );

-- Write SYSTEM trends: admins only.
drop policy if exists content_trends_admin_write on content_trends;
drop policy if exists content_trends_system_write on content_trends;
create policy content_trends_system_write on content_trends
  for all to authenticated
  using (scope = 'system' and exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin'))
  with check (scope = 'system' and exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin'));

-- Write PROJECT trends: the project owner.
drop policy if exists content_trends_project_write on content_trends;
create policy content_trends_project_write on content_trends
  for all to authenticated
  using (scope = 'project' and exists (
    select 1 from projects p where p.id = content_trends.project_id and p.owner_id = auth.uid()
  ))
  with check (scope = 'project' and exists (
    select 1 from projects p where p.id = content_trends.project_id and p.owner_id = auth.uid()
  ));
