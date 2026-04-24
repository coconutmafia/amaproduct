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

// GET — list all promo codes with use counts
export async function GET() {
  const ctx = await requireAdmin()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: codes } = await ctx.supabase
    .from('promo_codes')
    .select('*')
    .order('created_at', { ascending: false })

  return NextResponse.json({ codes: codes || [] })
}

// POST — create a new promo code
// body: { code?, bonus_generations, description?, max_uses?, expires_at? }
export async function POST(request: Request) {
  const ctx = await requireAdmin()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const {
    code,
    bonus_generations,
    description,
    max_uses,
    expires_at,
  } = body

  if (!bonus_generations || bonus_generations < 1) {
    return NextResponse.json({ error: 'bonus_generations must be ≥ 1' }, { status: 400 })
  }

  // Auto-generate code if not provided
  const finalCode = code
    ? code.toUpperCase().replace(/[^A-Z0-9]/g, '')
    : `PROMO${Math.random().toString(36).substring(2, 7).toUpperCase()}`

  const { data, error } = await ctx.supabase
    .from('promo_codes')
    .insert({
      code:              finalCode,
      bonus_generations: Number(bonus_generations),
      description:       description || null,
      max_uses:          max_uses ? Number(max_uses) : null,
      expires_at:        expires_at || null,
      created_by:        ctx.user.id,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Такой код уже существует' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ code: data })
}

// DELETE — deactivate a promo code
// body: { id }
export async function DELETE(request: Request) {
  const ctx = await requireAdmin()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await ctx.supabase
    .from('promo_codes')
    .update({ is_active: false })
    .eq('id', id)

  return NextResponse.json({ success: true })
}
