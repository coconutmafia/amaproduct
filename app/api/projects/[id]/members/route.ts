import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProjectRole } from '@/lib/projects/access'
import { PLAN_CONFIG } from '@/lib/generations-config'
import type { SubscriptionTier } from '@/lib/generations-config'
import { sendEmail, projectInviteEmail } from '@/lib/email'

// GET — roster (owner + any active member/viewer can see who's on the team).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const role = await getProjectRole(supabase, projectId, user.id)
  if (!role) return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })

  const { data: members, error } = await supabase
    .from('project_members')
    .select('id, user_id, invited_email, role, status, created_at, accepted_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ role, members: members ?? [] })
}

// POST — invite by email. Owner-only. If the email already has an account,
// membership activates immediately; otherwise it's claimed automatically the
// moment that email signs up (see migration 025: link_pending_project_invites).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params
  const role = await getProjectRole(supabase, projectId, user.id)
  if (!role) return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
  if (role !== 'owner') return NextResponse.json({ error: 'Пригласить в команду может только владелец проекта' }, { status: 403 })

  let body: { email?: string; role?: 'editor' | 'viewer' }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const email = (body.email ?? '').trim().toLowerCase()
  const inviteRole = body.role
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Укажи корректный email' }, { status: 400 })
  }
  if (inviteRole !== 'editor' && inviteRole !== 'viewer') {
    return NextResponse.json({ error: "role должен быть 'editor' или 'viewer'" }, { status: 400 })
  }

  const { data: project } = await supabase.from('projects').select('name').eq('id', projectId).single()

  const { data: ownerProfile } = await supabase
    .from('profiles').select('subscription_tier').eq('id', user.id).single()
  const tier = (ownerProfile?.subscription_tier ?? 'trial') as SubscriptionTier
  const seatLimit = PLAN_CONFIG[tier]?.teamSeats ?? 0

  const { count: used } = await supabase
    .from('project_members')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .in('status', ['pending', 'active'])
  if ((used ?? 0) >= seatLimit) {
    return NextResponse.json({
      error: seatLimit === 0
        ? 'Командный доступ недоступен на твоём тарифе — нужен тариф Про или Продюсер.'
        : `Лимит мест в команде исчерпан (${seatLimit}). Удали кого-то из команды или перейди на тариф выше.`,
    }, { status: 400 })
  }

  // Already has an account? Link immediately instead of waiting on signup.
  // Cross-user lookup by email needs the admin client — profiles RLS only
  // lets a session client read its own row.
  const admin = createAdminClient()
  const { data: existingProfile } = await admin
    .from('profiles').select('id').eq('email', email).maybeSingle()

  const { data: member, error } = await supabase
    .from('project_members')
    .insert({
      project_id: projectId,
      user_id: existingProfile?.id ?? null,
      invited_email: email,
      role: inviteRole,
      status: existingProfile ? 'active' : 'pending',
      invited_by: user.id,
      accepted_at: existingProfile ? new Date().toISOString() : null,
    })
    .select('id, user_id, invited_email, role, status')
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: `${email} уже приглашён(а) в этот проект` }, { status: 400 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { subject, html } = projectInviteEmail(project?.name ?? 'AMAproduct', inviteRole)
  await sendEmail(email, subject, html)

  return NextResponse.json({ member })
}
