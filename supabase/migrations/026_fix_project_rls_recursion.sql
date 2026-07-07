-- Fix: 025_project_members.sql introduced mutual RLS recursion between
-- `projects` and `project_members` — projects_select checks project_members,
-- and project_members's policies checked back into projects via a live
-- RLS-guarded subquery. Postgres detects this cycle and denies access
-- entirely ("infinite recursion detected in policy"), which is why the
-- owner's own project stopped showing up after 025 was applied.
--
-- Fix: make the ownership/membership checks SECURITY DEFINER, so their
-- internal reads of projects/project_members bypass RLS instead of
-- re-triggering it. Safe — they only ever return a boolean, no row data
-- leaks, and the check performed is identical to what RLS would do anyway.

create or replace function is_project_owner(p_project_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from projects where id = p_project_id and owner_id = auth.uid())
$$;

create or replace function has_project_access(p_project_id uuid, p_min_role text default 'viewer')
returns boolean
language sql stable security definer
set search_path = public
as $$
  select is_project_owner(p_project_id)
      or exists (
        select 1 from project_members
        where project_id = p_project_id and user_id = auth.uid() and status = 'active'
          and (p_min_role = 'viewer' or role = 'editor')
      )
$$;

-- projects: use the (now bypass-RLS) helper instead of a live subquery on
-- project_members.
drop policy if exists projects_select on projects;
create policy projects_select on projects
  for select to authenticated
  using (has_project_access(id, 'viewer'));

-- project_members: use is_project_owner() instead of a live subquery on
-- projects (that live subquery was the other half of the cycle).
drop policy if exists project_members_read on project_members;
create policy project_members_read on project_members
  for select to authenticated
  using (
    is_project_owner(project_members.project_id)
    or exists (
      select 1 from project_members m2
      where m2.project_id = project_members.project_id and m2.user_id = auth.uid() and m2.status = 'active'
    )
  );

drop policy if exists project_members_owner_write on project_members;
create policy project_members_owner_write on project_members
  for all to authenticated
  using (is_project_owner(project_members.project_id))
  with check (is_project_owner(project_members.project_id));
