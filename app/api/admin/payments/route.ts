import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Verify the calling user is admin (mirrors /api/admin/users).
async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return null
  return { db: createAdminClient() }
}

// GET — list payments (user, date, amount) for the admin/metabase.
// ?all=1 returns everyone (no 100-cap) for the Excel export.
// The ledger is empty until Prodamus/Stripe go live (see migration 031).
export async function GET(request: Request) {
  const ctx = await requireAdmin()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const all = new URL(request.url).searchParams.get('all') === '1'

  try {
    const { data: rows, error } = await ctx.db
      .from('payments')
      .select('id, user_id, amount, currency, status, provider, external_id, description, created_at')
      .order('created_at', { ascending: false })
    if (error) throw error

    const list = rows ?? []

    // Attach the payer's email (payments.user_id → profiles.email).
    const userIds = [...new Set(list.map(r => r.user_id).filter(Boolean))] as string[]
    const emailMap = new Map<string, string>()
    if (userIds.length > 0) {
      const { data: profiles } = await ctx.db
        .from('profiles').select('id, email').in('id', userIds)
      for (const p of profiles ?? []) emailMap.set(p.id, p.email ?? '')
    }

    const payments = list.map(r => ({ ...r, email: r.user_id ? (emailMap.get(r.user_id) ?? '') : '' }))
    return NextResponse.json({ payments: all ? payments : payments.slice(0, 100), total: payments.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('Admin payments GET error:', err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
