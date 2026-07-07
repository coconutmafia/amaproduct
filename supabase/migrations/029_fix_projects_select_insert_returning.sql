-- URGENT fix: project creation was broken for ALL users.
--
-- Root cause: projects_select (migration 026) delegates the OWNER check to
-- has_project_access()/is_project_owner(), which RE-QUERY the projects table by
-- id: `select 1 from projects where id = p_project_id and owner_id = auth.uid()`.
-- The wizard creates a project with `.insert().select()` = INSERT ... RETURNING.
-- During RETURNING, the SELECT policy runs on the just-inserted row, but that
-- secondary query inside the (STABLE) function does NOT yet see the new row, so
-- the policy returns false and Postgres raises 42501 "new row violates row-level
-- security policy for table projects" — even though the INSERT's WITH CHECK
-- passed. (Confirmed live: INSERT with return=minimal → 201; with
-- return=representation → 403.)
--
-- Fix: check owner_id DIRECTLY (a column reference on the NEW row is visible in
-- RETURNING), and route only the membership branch through the SECURITY DEFINER
-- helper (which queries project_members, not projects — so no recursion and no
-- self-visibility problem). The 026 recursion fix is preserved: projects_select
-- no longer sub-queries project_members directly (goes via is_active_project_member,
-- SECURITY DEFINER, RLS-bypassing), and project_members' own policies still route
-- through is_project_owner/is_active_project_member. No policy-evaluation cycle.
--
-- Note: content tables (project_materials, etc.) are NOT affected — their
-- has_project_access(project_id, ...) queries the PROJECTS table whose row
-- already exists, not the row being inserted. Only `projects` self-referenced.
drop policy if exists projects_select on projects;
create policy projects_select on projects
  for select to authenticated
  using (
    owner_id = auth.uid()
    or is_active_project_member(projects.id)
  );
