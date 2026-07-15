import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rateLimit'
import { suggestTrends } from '@/lib/ai/suggestTrends'
import { requireProjectAccess } from '@/lib/projects/access'
import { NextResponse } from 'next/server'

// Web search + our own niche data → a LIST of candidate "тренды месяца" the user
// can pick from. Grounded so we suggest real, current trends.
export const maxDuration = 180

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'suggest-trends')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  const body = await request.json() as { projectId?: string; scope?: 'project' | 'system'; niche?: string; mode?: 'niche' | 'popular' }
  const scope = body.scope === 'system' ? 'system' : 'project'
  const mode = body.mode === 'popular' ? 'popular' : 'niche'

  let niche = (body.niche || '').trim()
  let competitorsSummary = ''
  let reelsSummary = ''
  const existingTitles: string[] = []

  if (scope === 'project') {
    if (!body.projectId) return NextResponse.json({ error: 'projectId обязателен' }, { status: 400 })
    const access = await requireProjectAccess(supabase, body.projectId, user.id, 'editor')
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
    const { data: project } = await supabase
      .from('projects').select('*').eq('id', body.projectId).single()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    niche = niche || (project.niche || '').trim()

    // Competitor data only grounds NICHE mode (popular mode is intentionally broad).
    if (mode === 'niche') {
      try {
        const { data: igMats } = await supabase
          .from('project_materials').select('title, material_type, raw_content')
          .eq('project_id', body.projectId).in('material_type', ['competitors']).limit(6)
        competitorsSummary = (igMats ?? []).map(m => `${m.title}: ${String(m.raw_content ?? '').replace(/\s+/g, ' ').slice(0, 1200)}`).join('\n\n').slice(0, 4500)
      } catch { /* ignore */ }
      try {
        const nLower = niche.toLowerCase()
        const { data: sysReels } = await supabase.from('viral_reels').select('reel_type, analysis, niches').eq('scope', 'system').eq('is_active', true).limit(20)
        const { data: projReels } = await supabase.from('viral_reels').select('reel_type, analysis, niches').eq('scope', 'project').eq('project_id', body.projectId).limit(10)
        const matched = (sysReels ?? []).filter(r => {
          const ns = r.niches as string[] | null
          if (!ns || ns.length === 0) return true
          return ns.some(n => nLower.includes(n.toLowerCase()) || n.toLowerCase().includes(nLower))
        })
        reelsSummary = [...(projReels ?? []), ...matched].slice(0, 6)
          .map(r => `• ${r.reel_type}: ${String(r.analysis ?? '').slice(0, 350)}`).join('\n')
      } catch { /* ignore */ }
    }

    try {
      const { data: ex } = await supabase.from('content_trends').select('title')
        .or(`and(scope.eq.project,project_id.eq.${body.projectId}),scope.eq.system`)
      for (const t of ex ?? []) existingTitles.push(t.title as string)
    } catch { /* ignore */ }
  } else {
    // System scope — admins only.
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (mode === 'niche') {
      try {
        const nLower = niche.toLowerCase()
        const { data: sysReels } = await supabase.from('viral_reels').select('reel_type, analysis, niches').eq('scope', 'system').eq('is_active', true).limit(20)
        const matched = (sysReels ?? []).filter(r => {
          const ns = r.niches as string[] | null
          if (!ns || ns.length === 0 || !nLower) return true
          return ns.some(n => nLower.includes(n.toLowerCase()) || n.toLowerCase().includes(nLower))
        })
        reelsSummary = matched.slice(0, 8).map(r => `• ${r.reel_type}: ${String(r.analysis ?? '').slice(0, 350)}`).join('\n')
      } catch { /* ignore */ }
    }
    try {
      const { data: ex } = await supabase.from('content_trends').select('title').eq('scope', 'system')
      for (const t of ex ?? []) existingTitles.push(t.title as string)
    } catch { /* ignore */ }
  }

  try {
    const { trends, grounded } = await suggestTrends({ niche, mode, competitorsSummary, reelsSummary, existingTitles })
    if (trends.length === 0) {
      console.error(`[suggest-trends] 0 candidates (scope=${scope}, mode=${mode}, niche=${niche})`)
      return NextResponse.json({ error: 'Не удалось подобрать тренды — попробуй ещё раз' }, { status: 500 })
    }
    return NextResponse.json({ trends, grounded })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка AI'
    console.error('[suggest-trends] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
