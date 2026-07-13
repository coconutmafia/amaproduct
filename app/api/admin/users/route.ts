import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Verify the calling user is admin
async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return null
  return { db: createAdminClient() }
}

// GET — list all users from auth.users + merge with profiles
export async function GET(request: Request) {
  const ctx = await requireAdmin()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search')?.trim().toLowerCase()
  // ?all=1 — return everyone (no 100-row cap) so the admin can export the full
  // list to Excel. Still bounded by the 1000-user listUsers page below.
  const all = searchParams.get('all') === '1'

  try {
    // Fetch all auth users (bypasses RLS, sees everyone)
    const { data: authData, error: authError } = await ctx.db.auth.admin.listUsers({
      perPage: 1000,
    })
    if (authError) throw authError

    // Fetch all profiles with admin client
    const { data: profiles } = await ctx.db
      .from('profiles')
      .select('id, role, subscription_tier, subscription_status, trial_ends_at, current_period_end, payment_provider, generations_used, bonus_generations, generations_reset_at, created_at')

    const profileMap = new Map((profiles || []).map(p => [p.id, p]))

    // Merge auth users with profile data
    let users = authData.users.map(authUser => {
      const profile = profileMap.get(authUser.id) as Record<string, unknown> | undefined
      return {
        id: authUser.id,
        email: authUser.email || '',
        full_name: authUser.user_metadata?.full_name || authUser.user_metadata?.name || null,
        role: (profile?.role as string) ?? 'client',
        subscription_tier: (profile?.subscription_tier as string) ?? 'trial',
        subscription_status: (profile?.subscription_status as string) ?? 'trialing',
        trial_ends_at: (profile?.trial_ends_at as string) ?? null,
        current_period_end: (profile?.current_period_end as string) ?? null,
        payment_provider: (profile?.payment_provider as string) ?? null,
        generations_used: (profile?.generations_used as number) ?? 0,
        bonus_generations: (profile?.bonus_generations as number) ?? 0,
        generations_reset_at: (profile?.generations_reset_at as string) ?? null,
        created_at: (profile?.created_at as string) ?? authUser.created_at,
        last_sign_in_at: authUser.last_sign_in_at ?? null,
      }
    })

    // Filter by search
    if (search) {
      users = users.filter(u =>
        u.email.toLowerCase().includes(search) ||
        (u.full_name ?? '').toLowerCase().includes(search)
      )
    }

    // Sort newest first
    users.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    return NextResponse.json({ users: all ? users : users.slice(0, 100), total: users.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('Admin users GET error:', err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// PATCH — update user: bonus_generations, subscription_tier, role
export async function PATCH(request: Request) {
  const ctx = await requireAdmin()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { userId, bonus_generations, subscription_tier, role } = body

  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  const updates: Record<string, unknown> = {}
  if (bonus_generations !== undefined) updates.bonus_generations = Number(bonus_generations)
  if (subscription_tier !== undefined) updates.subscription_tier = subscription_tier
  if (role !== undefined) updates.role = role

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  // Check if profile exists
  const { data: existing } = await ctx.db
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .single()

  let data, error
  if (existing) {
    // Profile exists — just update
    ;({ data, error } = await ctx.db
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select('id, role, subscription_tier, generations_used, bonus_generations')
      .single())
  } else {
    // Profile missing — get email from Auth, then insert
    const { data: authUser } = await ctx.db.auth.admin.getUserById(userId)
    const email = authUser?.user?.email
    if (!email) return NextResponse.json({ error: 'User not found in auth' }, { status: 404 })
    ;({ data, error } = await ctx.db
      .from('profiles')
      .insert({ id: userId, email, role: 'client', ...updates })
      .select('id, role, subscription_tier, generations_used, bonus_generations')
      .single())
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ user: data })
}

// POST — reset monthly usage for a user
export async function POST(request: Request) {
  const ctx = await requireAdmin()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { userId } = await request.json()
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  const { error } = await ctx.db
    .from('profiles')
    .update({ generations_used: 0, generations_reset_at: new Date().toISOString() })
    .eq('id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
