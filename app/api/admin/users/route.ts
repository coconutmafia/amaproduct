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

  try {
    // Fetch all auth users (bypasses RLS, sees everyone)
    const { data: authData, error: authError } = await ctx.db.auth.admin.listUsers({
      perPage: 1000,
    })
    if (authError) throw authError

    // Fetch all profiles with admin client
    const { data: profiles } = await ctx.db
      .from('profiles')
      .select('id, role, subscription_tier, generations_used, bonus_generations, generations_reset_at, created_at')

    const profileMap = new Map((profiles || []).map(p => [p.id, p]))

    // Merge auth users with profile data
    let users = authData.users.map(authUser => {
      const profile = profileMap.get(authUser.id)
      return {
        id: authUser.id,
        email: authUser.email || '',
        full_name: authUser.user_metadata?.full_name || authUser.user_metadata?.name || null,
        role: profile?.role ?? 'client',
        subscription_tier: profile?.subscription_tier ?? 'free',
        generations_used: profile?.generations_used ?? 0,
        bonus_generations: profile?.bonus_generations ?? 0,
        generations_reset_at: profile?.generations_reset_at ?? null,
        created_at: profile?.created_at ?? authUser.created_at,
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

    return NextResponse.json({ users: users.slice(0, 100) })
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

  // Upsert — creates profile row if it doesn't exist yet
  const { data, error } = await ctx.db
    .from('profiles')
    .upsert({ id: userId, ...updates }, { onConflict: 'id' })
    .select('id, role, subscription_tier, generations_used, bonus_generations')
    .single()

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
