import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return null
  return { supabase, user }
}

// GET — list users (with optional ?search=email)
export async function GET(request: Request) {
  const ctx = await requireAdmin()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search')?.trim()

  let query = ctx.supabase
    .from('profiles')
    .select('id, email, full_name, role, subscription_tier, generations_used, bonus_generations, generations_reset_at, created_at')
    .order('created_at', { ascending: false })
    .limit(50)

  if (search) {
    query = query.ilike('email', `%${search}%`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ users: data || [] })
}

// PATCH — update user: bonus_generations, subscription_tier, role
// body: { userId, bonus_generations?, subscription_tier?, role? }
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

  const { data, error } = await ctx.supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select('id, email, full_name, role, subscription_tier, generations_used, bonus_generations')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ user: data })
}

// POST — reset monthly usage for a user
// body: { userId }
export async function POST(request: Request) {
  const ctx = await requireAdmin()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { userId } = await request.json()
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  const { error } = await ctx.supabase
    .from('profiles')
    .update({ generations_used: 0, generations_reset_at: new Date().toISOString() })
    .eq('id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
