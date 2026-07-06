-- Multi-user projects (roles + email invites) for the Producer/Pro tiers.
-- Until now every project-scoped table's RLS checked ONLY projects.owner_id —
-- there was no way to give a teammate or client access to someone else's
-- project. This migration adds project_members (roles: editor/viewer — owner
-- stays implicit via projects.owner_id, no second source of truth for it) and
-- retrofits RLS across every project-scoped table to also accept members.

-- ===== 1. project_members =====
create table if not exists project_members (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete cascade,   -- null until the invite is claimed
  invited_email text,                                              -- lower(), used to auto-link on signup
  role         text not null check (role in ('editor','viewer')),
  status       text not null default 'pending' check (status in ('pending','active')),
  invited_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz
);

create unique index if not exists project_members_user_uidx
  on project_members (project_id, user_id) where user_id is not null;
create unique index if not exists project_members_invite_uidx
  on project_members (project_id, lower(invited_email)) where status = 'pending';
create index if not exists project_members_project_idx on project_members (project_id);
create index if not exists project_members_user_idx on project_members (user_id);

alter table project_members enable row level security;

-- Any accepted member (or the owner) can see the full roster of their project.
drop policy if exists project_members_read on project_members;
create policy project_members_read on project_members
  for select to authenticated
  using (
    exists (select 1 from projects p where p.id = project_members.project_id and p.owner_id = auth.uid())
    or exists (
      select 1 from project_members m2
      where m2.project_id = project_members.project_id and m2.user_id = auth.uid() and m2.status = 'active'
    )
  );

-- Only the project owner manages membership (invite / change role / remove).
drop policy if exists project_members_owner_write on project_members;
create policy project_members_owner_write on project_members
  for all to authenticated
  using (exists (select 1 from projects p where p.id = project_members.project_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from projects p where p.id = project_members.project_id and p.owner_id = auth.uid()));

-- A member can remove their own membership ("leave project").
drop policy if exists project_members_self_leave on project_members;
create policy project_members_self_leave on project_members
  for delete to authenticated
  using (user_id = auth.uid());

-- ===== 2. has_project_access() — shared helper for every OTHER project-scoped
-- table's RLS. Deliberately NOT used inside projects'/project_members' own
-- policies (written directly above) to avoid any self-referential recursion.
-- Not SECURITY DEFINER: it only queries tables the caller already has SELECT
-- access to for their own membership rows, so no privilege escalation needed.
create or replace function has_project_access(p_project_id uuid, p_min_role text default 'viewer')
returns boolean
language sql stable
as $$
  select exists (select 1 from projects p where p.id = p_project_id and p.owner_id = auth.uid())
      or exists (
        select 1 from project_members m
        where m.project_id = p_project_id and m.user_id = auth.uid() and m.status = 'active'
          and (p_min_role = 'viewer' or m.role = 'editor')
      )
$$;

-- ===== 3. projects — extend SELECT to members; INSERT/UPDATE/DELETE (settings,
-- danger zone) stays owner-only, written directly (not via the helper above).
drop policy if exists "Users can manage own projects" on projects;

create policy projects_select on projects
  for select to authenticated
  using (
    owner_id = auth.uid()
    or exists (select 1 from project_members m where m.project_id = projects.id and m.user_id = auth.uid() and m.status = 'active')
  );

create policy projects_owner_write on projects
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy projects_owner_update on projects
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy projects_owner_delete on projects
  for delete to authenticated
  using (owner_id = auth.uid());

-- ===== 4. Retrofit project-scoped content tables: SELECT for viewer+,
-- INSERT/UPDATE/DELETE for editor+. Same table list the July-1 audit already
-- established as "project-scoped" (see PROJECT_CONTEXT.md).

drop policy if exists "Users can manage own project materials" on project_materials;
create policy project_materials_select on project_materials
  for select to authenticated using (has_project_access(project_id, 'viewer'));
create policy project_materials_write on project_materials
  for all to authenticated
  using (has_project_access(project_id, 'editor')) with check (has_project_access(project_id, 'editor'));

drop policy if exists "Users can manage own project chunks" on project_chunks;
create policy project_chunks_select on project_chunks
  for select to authenticated using (has_project_access(project_id, 'viewer'));
create policy project_chunks_write on project_chunks
  for all to authenticated
  using (has_project_access(project_id, 'editor')) with check (has_project_access(project_id, 'editor'));

drop policy if exists "Users can manage own products" on products;
create policy products_select on products
  for select to authenticated using (has_project_access(project_id, 'viewer'));
create policy products_write on products
  for all to authenticated
  using (has_project_access(project_id, 'editor')) with check (has_project_access(project_id, 'editor'));

drop policy if exists "Users can manage own funnels" on funnels;
create policy funnels_select on funnels
  for select to authenticated using (has_project_access(project_id, 'viewer'));
create policy funnels_write on funnels
  for all to authenticated
  using (has_project_access(project_id, 'editor')) with check (has_project_access(project_id, 'editor'));

drop policy if exists "Users can manage own warmup plans" on warmup_plans;
create policy warmup_plans_select on warmup_plans
  for select to authenticated using (has_project_access(project_id, 'viewer'));
create policy warmup_plans_write on warmup_plans
  for all to authenticated
  using (has_project_access(project_id, 'editor')) with check (has_project_access(project_id, 'editor'));

drop policy if exists "Users can manage own content plans" on content_plans;
create policy content_plans_select on content_plans
  for select to authenticated using (has_project_access(project_id, 'viewer'));
create policy content_plans_write on content_plans
  for all to authenticated
  using (has_project_access(project_id, 'editor')) with check (has_project_access(project_id, 'editor'));

drop policy if exists "Users can manage own content items" on content_items;
create policy content_items_select on content_items
  for select to authenticated using (has_project_access(project_id, 'viewer'));
create policy content_items_write on content_items
  for all to authenticated
  using (has_project_access(project_id, 'editor')) with check (has_project_access(project_id, 'editor'));

drop policy if exists "Users can manage own ai conversations" on ai_conversations;
create policy ai_conversations_select on ai_conversations
  for select to authenticated using (has_project_access(project_id, 'viewer'));
create policy ai_conversations_write on ai_conversations
  for all to authenticated
  using (has_project_access(project_id, 'editor')) with check (has_project_access(project_id, 'editor'));

drop policy if exists "Users can manage own style examples" on style_examples;
create policy style_examples_select on style_examples
  for select to authenticated using (has_project_access(project_id, 'viewer'));
create policy style_examples_write on style_examples
  for all to authenticated
  using (has_project_access(project_id, 'editor')) with check (has_project_access(project_id, 'editor'));

-- content_versions: 2-level indirection via content_items.project_id.
drop policy if exists "Users can manage own content versions" on content_versions;

create policy content_versions_select on content_versions
  for select to authenticated
  using (exists (
    select 1 from content_items ci where ci.id = content_item_id and has_project_access(ci.project_id, 'viewer')
  ));

create policy content_versions_write on content_versions
  for all to authenticated
  using (exists (
    select 1 from content_items ci where ci.id = content_item_id and has_project_access(ci.project_id, 'editor')
  ))
  with check (exists (
    select 1 from content_items ci where ci.id = content_item_id and has_project_access(ci.project_id, 'editor')
  ));

-- viral_reels: extend the project-write policy (was owner-only) to editor+.
-- Read policy already branches on scope='project' + project ownership — widen
-- that branch to viewer+ too.
drop policy if exists viral_reels_read on viral_reels;
create policy viral_reels_read on viral_reels
  for select to authenticated
  using (
    (scope = 'system' and is_active = true)
    or (scope = 'project' and has_project_access(viral_reels.project_id, 'viewer'))
    or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin')
  );

drop policy if exists viral_reels_project_write on viral_reels;
create policy viral_reels_project_write on viral_reels
  for all to authenticated
  using (scope = 'project' and has_project_access(viral_reels.project_id, 'editor'))
  with check (scope = 'project' and has_project_access(viral_reels.project_id, 'editor'));

-- content_trends: same scope-based pattern as viral_reels.
drop policy if exists content_trends_read on content_trends;
create policy content_trends_read on content_trends
  for select to authenticated
  using (
    (scope = 'system' and is_active = true)
    or (scope = 'project' and has_project_access(content_trends.project_id, 'viewer'))
    or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin')
  );

drop policy if exists content_trends_project_write on content_trends;
create policy content_trends_project_write on content_trends
  for all to authenticated
  using (scope = 'project' and has_project_access(content_trends.project_id, 'editor'))
  with check (scope = 'project' and has_project_access(content_trends.project_id, 'editor'));

-- saved_content: keep writes user-scoped (unchanged), ADD team read visibility
-- so an invited teammate/client sees the same "Готовое"/results the owner does.
drop policy if exists saved_content_team_read on saved_content;
create policy saved_content_team_read on saved_content
  for select to authenticated
  using (user_id = auth.uid() or (project_id is not null and has_project_access(project_id, 'viewer')));

-- ===== 5. Auto-link a pending invite when the invited email signs up. Runs
-- AFTER handle_new_user() has inserted the profiles row (any signup path).
-- SECURITY DEFINER: the brand-new user has no RLS access to the pending
-- project_members row yet (they're not a member until this runs).
create or replace function link_pending_project_invites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update project_members
     set user_id = new.id, status = 'active', accepted_at = now()
   where status = 'pending' and lower(invited_email) = lower(new.email);
  return new;
end;
$$;

drop trigger if exists on_profile_created_link_invites on profiles;
create trigger on_profile_created_link_invites
  after insert on profiles
  for each row execute function link_pending_project_invites();
