import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL, MODEL_HAIKU } from '@/lib/ai/client'
import { NextResponse } from 'next/server'

// Web search + our own niche data → a LIST of candidate "тренды месяца" the user
// can pick from. Grounded so we suggest real, current trends (not the model's
// stale guesses): live web search for what's trending now + the project's
// scraped competitors + analysed viral reels.
export const maxDuration = 180

const ALLOWED_FORMATS = ['any', 'post', 'reels', 'stories', 'carousel']

interface Candidate {
  title: string
  description: string
  example: string | null
  format_type: string
}

// Tolerant array reader (the model sometimes serialises a nested array as a string).
function toArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { projectId?: string; scope?: 'project' | 'system'; niche?: string }
  const scope = body.scope === 'system' ? 'system' : 'project'

  // ── Resolve niche + grounding data ─────────────────────────────────────────
  let niche = (body.niche || '').trim()
  let competitorsSummary = ''
  let reelsSummary = ''
  const existingTitles: string[] = []

  if (scope === 'project') {
    if (!body.projectId) return NextResponse.json({ error: 'projectId обязателен' }, { status: 400 })
    const { data: project } = await supabase
      .from('projects').select('*').eq('id', body.projectId).eq('owner_id', user.id).single()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    niche = niche || (project.niche || '').trim()

    // Competitors / own Instagram (real, recently scraped)
    try {
      const { data: igMats } = await supabase
        .from('project_materials').select('title, material_type, raw_content')
        .eq('project_id', body.projectId).in('material_type', ['my_instagram', 'competitors']).limit(6)
      const ext = (igMats ?? []).filter(m => m.material_type === 'competitors')
      competitorsSummary = ext.map(m => `${m.title}: ${String(m.raw_content ?? '').replace(/\s+/g, ' ').slice(0, 1200)}`).join('\n\n').slice(0, 4500)
    } catch { /* ignore */ }

    // Viral reels (analysed) — project's own + niche-matched system
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

    // Existing project + system trends — avoid duplicates
    try {
      const { data: ex } = await supabase.from('content_trends').select('title, scope, project_id, niches')
        .or(`and(scope.eq.project,project_id.eq.${body.projectId}),scope.eq.system`)
      for (const t of ex ?? []) existingTitles.push(t.title as string)
    } catch { /* ignore */ }
  } else {
    // System scope — admins only.
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
    try {
      const { data: ex } = await supabase.from('content_trends').select('title').eq('scope', 'system')
      for (const t of ex ?? []) existingTitles.push(t.title as string)
    } catch { /* ignore */ }
  }

  const nicheLabel = niche || 'блогеры/эксперты (общая ниша)'

  try {
    // ── Step 1: live web research (graceful — skip if it fails / unavailable) ──
    let webResearch = ''
    try {
      const searchRes = await anthropic.messages.create({
        model: MODEL_HAIKU, // Haiku does web search ~10x faster than Sonnet
        max_tokens: 1500,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 } as any],
        messages: [{
          role: 'user',
          content: `Найди в интернете АКТУАЛЬНЫЕ тренды контента для Instagram и соцсетей в нише «${nicheLabel}» за последние 1–2 месяца: залетающие форматы рилз, темы, хуки, структуры, аудио/визуальные тренды. Кратко перечисли 6–10 пунктов — что СЕЙЧАС работает, с конкретикой. Только то, что реально актуально сейчас, без воды.`,
        }],
      })
      webResearch = searchRes.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n').trim()
    } catch (e) {
      console.warn('[suggest-trends] web search skipped:', e instanceof Error ? e.message : e)
    }

    // ── Step 2: synthesise a clean structured list (forced tool) ──────────────
    const groundBlocks = [
      webResearch ? `СВЕЖИЕ ТРЕНДЫ ИЗ ИНТЕРНЕТА (за последний месяц):\n${webResearch}` : '',
      competitorsSummary ? `ЧТО ДЕЛАЮТ КОНКУРЕНТЫ (реальные посты из их Instagram):\n${competitorsSummary}` : '',
      reelsSummary ? `ЗАЛЕТЕВШИЕ РИЛЗ В НИШЕ (разбор: хук/структура/почему зашло):\n${reelsSummary}` : '',
      existingTitles.length ? `УЖЕ ДОБАВЛЕННЫЕ ТРЕНДЫ (НЕ повторяй их):\n${existingTitles.map(t => `- ${t}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n')

    const prompt = `Ты — тренд-аналитик сервиса AMA для блогеров. Предложи 6–8 КОНКРЕТНЫХ трендов месяца для ниши «${nicheLabel}», которые блогер может сразу применить в контенте.

${groundBlocks || '(Дополнительных данных нет — опирайся на нишу и проверенные залетающие форматы.)'}

ПРАВИЛА:
- Каждый тренд — это формат/тема/структура, а не абстракция. Конкретно и применимо.
- Опирайся на свежие данные выше (интернет, конкуренты, залетевшие рилз). Если данных мало — бери проверенные форматы под нишу, но не выдумывай несуществующие «вирусные» цифры.
- НЕ повторяй уже добавленные тренды.
- title — короткое название (напр. «Формат „Миф vs Правда“», «Рубрика „Один день из…“»).
- description — что это и как использовать, 1–2 предложения, по-человечески.
- example — конкретный пример под нишу.
- format_type — один из: any, post, reels, stories, carousel.

Верни список через инструмент propose_trends.`

    const toolDef = {
      name: 'propose_trends',
      description: 'Список предложенных трендов месяца',
      input_schema: {
        type: 'object' as const,
        properties: {
          trends: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                example: { type: 'string' },
                format_type: { type: 'string', description: 'any | post | reels | stories | carousel' },
              },
              required: ['title', 'description'],
            },
          },
        },
        required: ['trends'],
      },
    }

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      tools: [toolDef],
      tool_choice: { type: 'tool' as const, name: 'propose_trends' },
      messages: [{ role: 'user', content: prompt }],
    })

    const toolBlock = response.content.find(b => b.type === 'tool_use')
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      return NextResponse.json({ error: 'AI не вернул тренды — попробуй ещё раз' }, { status: 500 })
    }
    const input = toolBlock.input as { trends?: unknown }
    const raw = toArray(input.trends) as Array<Record<string, unknown>>

    // Validate first, then dedup against existing titles. If dedup removes
    // everything, fall back to the validated (non-deduped) list rather than
    // failing — better to show slightly-overlapping ideas than nothing.
    const valid: Candidate[] = []
    for (const t of raw) {
      const title = String(t.title ?? '').trim()
      const description = String(t.description ?? '').trim()
      if (!title || !description) continue
      const fmt = String(t.format_type ?? 'any').toLowerCase()
      valid.push({
        title,
        description,
        example: (String(t.example ?? '').trim()) || null,
        format_type: ALLOWED_FORMATS.includes(fmt) ? fmt : 'any',
      })
    }
    const seen = new Set(existingTitles.map(t => t.trim().toLowerCase()))
    const deduped = valid.filter(c => !seen.has(c.title.toLowerCase()))
    const candidates = deduped.length > 0 ? deduped : valid

    if (candidates.length === 0) {
      console.error(`[suggest-trends] 0 candidates (raw=${raw.length}, valid=${valid.length}, existing=${existingTitles.length}, web=${!!webResearch})`)
      return NextResponse.json({ error: 'Не удалось подобрать тренды — попробуй ещё раз' }, { status: 500 })
    }
    return NextResponse.json({ trends: candidates, grounded: { web: !!webResearch, competitors: !!competitorsSummary, reels: !!reelsSummary } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка AI'
    console.error('[suggest-trends] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
