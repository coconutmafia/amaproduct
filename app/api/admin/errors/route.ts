import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Recent server/job/cron errors from the in-app log (error_events, migration
// 028). Admin-only. This is the queryable-by-us companion to Sentry's email
// alerts — when something breaks, read here instead of forwarding from Sentry.
async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return null
  return { db: createAdminClient() }
}

// GET /api/admin/errors?limit=100&level=error&since=24h
export async function GET(request: Request) {
  const ctx = await requireAdmin()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 100, 1), 500)
  const level = searchParams.get('level')

  let q = ctx.db
    .from('error_events')
    .select('id, level, source, route, message, stack, context, user_id, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (level) q = q.eq('level', level)

  const { data, error } = await q
  if (error) {
    // Table may not exist yet (migration 028 unapplied) — say so instead of 500.
    if (error.message?.includes('does not exist')) return NextResponse.json({ events: [], needsMigration: true })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ events: data ?? [] })
}

// DELETE /api/admin/errors            → clear ALL
// DELETE /api/admin/errors?id=<uuid>  → clear one
export async function DELETE(request: Request) {
  const ctx = await requireAdmin()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = new URL(request.url).searchParams.get('id')
  const q = ctx.db.from('error_events').delete()
  const { error } = id
    ? await q.eq('id', id)
    : await q.gte('created_at', '1970-01-01') // delete-all needs a filter
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
