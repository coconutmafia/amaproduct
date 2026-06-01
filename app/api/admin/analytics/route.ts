import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return null
  return { supabase, user }
}

// Rough cost estimate per generation (Claude tokens with large RAG context).
// Tunable as real usage data comes in.
const COST_PER_GENERATION_USD = 0.18

export async function GET() {
  const ctx = await requireAdmin()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { supabase } = ctx

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, subscription_tier, subscription_expires_at, generations_used, bonus_generations, created_at')
    .order('created_at', { ascending: false })

  const users = profiles ?? []
  const ids = users.map(u => u.id)

  // Aggregate counts per user in bulk
  const countBy = async (table: string, col: string) => {
    const map = new Map<string, number>()
    if (ids.length === 0) return map
    const { data } = await supabase.from(table).select(col).in(col, ids)
    for (const row of (data ?? []) as Record<string, string>[]) {
      const k = row[col]
      map.set(k, (map.get(k) ?? 0) + 1)
    }
    return map
  }

  const projectsByOwner = await countBy('projects', 'owner_id')

  // content_items + project_materials are linked via project → need owner map
  const { data: projRows } = ids.length > 0
    ? await supabase.from('projects').select('id, owner_id').in('owner_id', ids)
    : { data: [] }
  const projOwner = new Map<string, string>()
  for (const p of (projRows ?? []) as { id: string; owner_id: string }[]) projOwner.set(p.id, p.owner_id)
  const projIds = [...projOwner.keys()]

  const tallyByProject = async (table: string) => {
    const map = new Map<string, number>()
    if (projIds.length === 0) return map
    const { data } = await supabase.from(table).select('project_id').in('project_id', projIds)
    for (const row of (data ?? []) as { project_id: string }[]) {
      const owner = projOwner.get(row.project_id)
      if (owner) map.set(owner, (map.get(owner) ?? 0) + 1)
    }
    return map
  }

  const itemsByOwner = await tallyByProject('content_items')
  const materialsByOwner = await tallyByProject('project_materials')

  const now = Date.now()
  const rows = users.map(u => {
    const gens = u.generations_used ?? 0
    const trialActive = u.subscription_expires_at ? new Date(u.subscription_expires_at).getTime() > now : false
    return {
      id:               u.id,
      email:            u.email,
      name:             u.full_name,
      role:             u.role,
      tier:             u.subscription_tier ?? 'free',
      trialEndsAt:      u.subscription_expires_at,
      trialActive,
      generationsUsed:  gens,
      bonus:            u.bonus_generations ?? 0,
      projects:         projectsByOwner.get(u.id) ?? 0,
      materials:        materialsByOwner.get(u.id) ?? 0,
      contentItems:     itemsByOwner.get(u.id) ?? 0,
      estCostUsd:       +(gens * COST_PER_GENERATION_USD).toFixed(2),
      createdAt:        u.created_at,
    }
  })

  const totals = {
    users:       rows.length,
    generations: rows.reduce((s, r) => s + r.generationsUsed, 0),
    contentItems:rows.reduce((s, r) => s + r.contentItems, 0),
    estCostUsd:  +rows.reduce((s, r) => s + r.estCostUsd, 0).toFixed(2),
    trialsActive:rows.filter(r => r.trialActive).length,
  }

  return NextResponse.json({ rows, totals, costPerGeneration: COST_PER_GENERATION_USD })
}

// PATCH — grant / revoke a free trial for a user.
// body: { userId, months } — sets subscription_expires_at = now + months (and
// tier='trial'). months=0 revokes (clears the date back to free).
export async function PATCH(request: Request) {
  const ctx = await requireAdmin()
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json() as { userId?: string; months?: number }
  if (!body.userId) return NextResponse.json({ error: 'userId обязателен' }, { status: 400 })

  const months = body.months ?? 2
  let patch: Record<string, unknown>
  if (months <= 0) {
    patch = { subscription_tier: 'free', subscription_expires_at: null }
  } else {
    const ends = new Date()
    ends.setMonth(ends.getMonth() + months)
    patch = { subscription_tier: 'trial', subscription_expires_at: ends.toISOString() }
  }

  const { data, error } = await ctx.supabase
    .from('profiles')
    .update(patch)
    .eq('id', body.userId)
    .select('id, subscription_tier, subscription_expires_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, profile: data })
}
