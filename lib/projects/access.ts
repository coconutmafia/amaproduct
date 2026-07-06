import type { SupabaseClient } from '@supabase/supabase-js'

// UI-gating helper only — NOT the security boundary (RLS, migration
// 025_project_members.sql, is). Used to decide what to render (hide "Команда"
// from non-owners, hide edit controls from viewers), so a stale/bypassed
// check here can never grant real access — the DB still enforces it.
export type ProjectRole = 'owner' | 'editor' | 'viewer'

export async function getProjectRole(
  supabase: SupabaseClient,
  projectId: string,
  userId: string
): Promise<ProjectRole | null> {
  const { data: project } = await supabase
    .from('projects')
    .select('owner_id')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) return null
  if (project.owner_id === userId) return 'owner'

  const { data: member } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()
  return (member?.role as ProjectRole | undefined) ?? null
}

export type ProjectAccessResult =
  | { ok: true; role: ProjectRole }
  | { ok: false; status: 404 | 403; error: string }

// For routes whose actual write goes through the ADMIN/service-role client
// (storage uploads, brand_kit updates, etc.) — those bypass RLS entirely, so
// THIS check is the real access boundary, not a redundant one. Routes whose
// writes go through the session client can rely on RLS directly and don't
// need this — see migration 025_project_members.sql.
export async function requireProjectAccess(
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
  minRole: 'viewer' | 'editor' = 'viewer'
): Promise<ProjectAccessResult> {
  const role = await getProjectRole(supabase, projectId, userId)
  if (!role) return { ok: false, status: 404, error: 'Проект не найден' }
  if (minRole === 'editor' && role === 'viewer') {
    return { ok: false, status: 403, error: 'Доступно только владельцу или редактору проекта' }
  }
  return { ok: true, role }
}
