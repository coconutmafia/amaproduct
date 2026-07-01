import { createAdminClient } from '@/lib/supabase/admin'
import { suggestTrends } from '@/lib/ai/suggestTrends'
import { NextResponse } from 'next/server'

// Weekly auto-refresh of SYSTEM trends so the service stays current without manual
// work. Triggered by Vercel Cron (see vercel.json). Refreshes a general "popular"
// batch (all niches) + a per-niche batch for each distinct active-project niche.
//
// Auto-generated trends are marked by created_by IS NULL — manual admin trends
// always carry created_by = the admin's id — so we can replace just the auto
// batch each run without a schema migration.
export const maxDuration = 300

async function handle(request: Request) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  const isVercelCron = request.headers.get('x-vercel-cron') != null
  if (secret) {
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  } else if (!isVercelCron) {
    // No secret configured yet — only allow Vercel's own cron header.
    console.warn('[refresh-trends] CRON_SECRET not set — set it in env for security.')
    return NextResponse.json({ error: 'Forbidden (set CRON_SECRET)' }, { status: 403 })
  }

  const admin = createAdminClient()

  // Top niches across active projects (by project count). Capped to keep each
  // weekly run well under maxDuration — each batch is a web search + synthesis,
  // and Anthropic rate-limits concurrency, so we keep the batch count small.
  let niches: string[] = []
  try {
    const { data: projs } = await admin.from('projects').select('niche').eq('status', 'active')
    const counts = new Map<string, number>()
    for (const p of projs ?? []) {
      const n = (p.niche || '').trim()
      if (n) counts.set(n, (counts.get(n) ?? 0) + 1)
    }
    niches = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(e => e[0])
  } catch { /* ignore */ }

  // Manual system trend titles — dedup against these (the auto batch is replaced).
  let manualTitles: string[] = []
  try {
    const { data: ex } = await admin.from('content_trends').select('title').eq('scope', 'system').not('created_by', 'is', null)
    manualTitles = (ex ?? []).map(t => t.title as string)
  } catch { /* ignore */ }

  const batches: Array<{ niche: string; mode: 'niche' | 'popular'; nichesCol: string[] | null }> = [
    { niche: '', mode: 'popular', nichesCol: null },
    ...niches.map(n => ({ niche: n, mode: 'niche' as const, nichesCol: [n] })),
  ]

  // Load system reels once, reused across batches.
  let allReels: Array<{ reel_type: unknown; analysis: unknown; niches: unknown }> = []
  try {
    const { data: reels } = await admin.from('viral_reels').select('reel_type, analysis, niches').eq('scope', 'system').eq('is_active', true).limit(20)
    allReels = reels ?? []
  } catch { /* ignore */ }

  // Process batches SEQUENTIALLY — Anthropic rate-limits concurrency, so parallel
  // gave no speedup and made timing unpredictable. Few batches keep us under 300s.
  const seenTitles = new Set(manualTitles.map(t => t.trim().toLowerCase()))
  const rows: Record<string, unknown>[] = []
  const report: Record<string, number> = {}
  for (const b of batches) {
    const nLower = b.niche.toLowerCase()
    const matched = allReels.filter(r => {
      const ns = r.niches as string[] | null
      if (!ns || ns.length === 0 || !nLower) return true
      return ns.some(n => nLower.includes(n.toLowerCase()) || n.toLowerCase().includes(nLower))
    })
    const reelsSummary = matched.slice(0, 6).map(r => `• ${r.reel_type}: ${String(r.analysis ?? '').slice(0, 350)}`).join('\n')
    try {
      const { trends } = await suggestTrends({ niche: b.niche, mode: b.mode, reelsSummary, existingTitles: [...seenTitles], count: 6 })
      let added = 0
      for (const t of trends) {
        const key = t.title.trim().toLowerCase()
        if (seenTitles.has(key)) continue
        seenTitles.add(key)
        rows.push({ scope: 'system', created_by: null, is_active: true, title: t.title, description: t.description, example: t.example, format_type: t.format_type, niches: b.nichesCol })
        added++
      }
      report[b.niche || 'general'] = added
    } catch (e) {
      console.error('[refresh-trends] batch failed:', b.niche || 'general', e instanceof Error ? e.message : e)
      report[b.niche || 'general'] = -1
    }
  }

  // Replace auto-trends PER NICHE-SLOT: only slots that actually produced fresh
  // trends get their old auto-trends removed. A failed/empty batch keeps last
  // week's trends instead of going blank — before, one failed niche wiped ALL
  // auto-trends and left that niche without context for a week.
  const bySlot = new Map<string, Record<string, unknown>[]>()
  for (const r of rows) {
    const ns = r.niches as string[] | null
    const key = ns && ns.length ? ns[0] : '__general__'
    if (!bySlot.has(key)) bySlot.set(key, [])
    bySlot.get(key)!.push(r)
  }
  const replaced: string[] = []
  for (const [key, slotRows] of bySlot) {
    try {
      let del = admin.from('content_trends').delete().eq('scope', 'system').is('created_by', null)
      del = key === '__general__' ? del.is('niches', null) : del.contains('niches', [key])
      await del
      const { error } = await admin.from('content_trends').insert(slotRows)
      if (error) { console.error('[refresh-trends] insert slot failed:', key, error.message); continue }
      replaced.push(key)
    } catch (e) {
      console.error('[refresh-trends] replace slot failed:', key, e instanceof Error ? e.message : e)
    }
  }

  return NextResponse.json({ ok: true, inserted: rows.length, report, replacedSlots: replaced })
}

export async function GET(request: Request) { return handle(request) }
export async function POST(request: Request) { return handle(request) }
