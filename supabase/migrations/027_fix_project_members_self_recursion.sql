-- Fix: project_members_read (from 025) checked "is there another active
-- membership row for me in this project" via a live subquery on
-- project_members FROM WITHIN project_members's own SELECT policy. Postgres
-- flags this as recursion structurally (regardless of whether it would
-- actually terminate at runtime) and raises "infinite recursion detected in
-- policy for relation project_members" — this is why inviting someone
-- (INSERT ... RETURNING, which needs to re-check the new row's visibility)
-- failed with a 500, even though the plain roster GET happened to work.
--
-- Same fix as 026: wrap the self-check in a SECURITY DEFINER function so its
-- internal query bypasses RLS instead of re-triggering the same policy.

create or replace function is_active_project_member(p_project_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from project_members
    where project_id = p_project_id and user_id = auth.uid() and status = 'active'
  )
$$;

drop policy if exists project_members_read on project_members;
create policy project_members_read on project_members
  for select to authenticated
  using (
    is_project_owner(project_members.project_id)
    or is_active_project_member(project_members.project_id)
  );
