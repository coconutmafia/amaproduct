import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getProjectRole } from '@/lib/projects/access'

// PATCH — change a member's role. Owner-only.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId, memberId } = await params
  const role = await getProjectRole(supabase, projectId, user.id)
  if (!role) return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
  if (role !== 'owner') return NextResponse.json({ error: 'Менять роли может только владелец проекта' }, { status: 403 })

  let body: { role?: 'editor' | 'viewer' }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (body.role !== 'editor' && body.role !== 'viewer') {
    return NextResponse.json({ error: "role должен быть 'editor' или 'viewer'" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('project_members')
    .update({ role: body.role })
    .eq('id', memberId)
    .eq('project_id', projectId)
    .select('id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Участник не найден' }, { status: 404 })

  return NextResponse.json({ ok: true })
}

// DELETE — remove a member (owner) or leave the project (the member themselves).
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId, memberId } = await params
  const role = await getProjectRole(supabase, projectId, user.id)
  if (!role) return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })

  // RLS (project_members_owner_write / project_members_self_leave) is the real
  // gate: owner can remove anyone, a member can only delete their own row.
  const { data, error } = await supabase
    .from('project_members')
    .delete()
    .eq('id', memberId)
    .eq('project_id', projectId)
    .select('id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Нет доступа или участник не найден' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
