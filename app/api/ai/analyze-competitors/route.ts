import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rateLimit'
import { requirePaidAccess } from '@/lib/billing/access'
import { anthropic, MODEL } from '@/lib/ai/client'
import { requireProjectAccess } from '@/lib/projects/access'

// Builds a competitor-comparison TABLE from the scraped Instagram data the
// project already has (project_materials.material_type = 'competitors', plus the
// blogger's own 'my_instagram' for a tailored takeaway). Returns structured rows
// the client renders + exports to XLSX.
export const maxDuration = 120

function toArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}

export interface CompetitorRow {
  handle: string
  followers: string
  topics: string
  formats: string
  what_works: string
  tone: string
  posting: string
  strengths: string
  takeaway: string
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await rateLimit(user.id, 'analyze-competitors')
    if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

    const denied = await requirePaidAccess(user.id)
    if (denied) return denied

    const { projectId } = (await request.json()) as { projectId?: string }
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

    const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    const { data: project } = await supabase.from('projects').select('id, niche').eq('id', projectId).single()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const { data: comp } = await supabase
      .from('project_materials')
      .select('title, raw_content')
      .eq('project_id', projectId)
      .eq('material_type', 'competitors')
    const competitors = (comp ?? []).filter((c) => (c.raw_content || '').trim())
    if (competitors.length === 0) return NextResponse.json({ error: 'Сначала добавь конкурентов в Instagram (раздел «Конкуренты»).' }, { status: 400 })

    const { data: mine } = await supabase
      .from('project_materials')
      .select('raw_content')
      .eq('project_id', projectId)
      .eq('material_type', 'my_instagram')
      .limit(1)

    const compBlocks = competitors.map((c, i) => `### Конкурент ${i + 1}: ${c.title}\n${(c.raw_content || '').slice(0, 2800)}`).join('\n\n')
    const mineBlock = (mine?.[0]?.raw_content || '').slice(0, 1500)

    const prompt = `Ты — стратег-аналитик контента для блогеров. По данным из Instagram ниже составь СРАВНИТЕЛЬНУЮ ТАБЛИЦУ конкурентов${project.niche ? ` (ниша: «${project.niche}»)` : ''}.

Для КАЖДОГО конкурента заполни поля кратко и по делу (без воды):
- handle — ник (@…)
- followers — число подписчиков (как в данных, можно «~30k»)
- topics — основные темы/рубрики контента
- formats — какие форматы использует (рилз/карусели/посты/сторис) и на чём акцент
- what_works — что у него ЗАХОДИТ (по охватам/лайкам/комментам — конкретные темы/механики)
- tone — тон и подача (экспертный/лайфстайл/провокация и т.п.)
- posting — регулярность/частота, если видно
- strengths — сильные стороны
- takeaway — ВЫВОД для нашего блогера: что перенять и чем отстроиться${mineBlock ? ' (учитывая его аккаунт ниже)' : ''}

${mineBlock ? `НАШ АККАУНТ (для вывода):\n${mineBlock}\n\n` : ''}ДАННЫЕ КОНКУРЕНТОВ:\n${compBlocks}

Верни РОВНО ${competitors.length} строк через инструмент competitor_analysis (по одной на конкурента). Не возвращай пустой список.`

    const tool = {
      name: 'competitor_analysis',
      description: 'Сравнительная таблица конкурентов',
      input_schema: {
        type: 'object' as const,
        properties: {
          competitors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                handle: { type: 'string' }, followers: { type: 'string' }, topics: { type: 'string' },
                formats: { type: 'string' }, what_works: { type: 'string' }, tone: { type: 'string' },
                posting: { type: 'string' }, strengths: { type: 'string' }, takeaway: { type: 'string' },
              },
              required: ['handle'],
            },
          },
        },
        required: ['competitors'],
      },
    }

    // Forced tool calls intermittently return an empty array — retry until non-empty.
    let raw: Array<Record<string, unknown>> = []
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4000,
        tools: [tool],
        tool_choice: { type: 'tool' as const, name: 'competitor_analysis' },
        messages: [{ role: 'user', content: prompt }],
      })
      const block = res.content.find((b) => b.type === 'tool_use')
      if (block && block.type === 'tool_use') raw = toArray((block.input as { competitors?: unknown }).competitors) as Array<Record<string, unknown>>
      if (raw.length > 0) break
      console.warn(`[analyze-competitors] empty result, retry ${attempt + 1}/4`)
    }

    const s = (v: unknown) => String(v ?? '').trim()
    const rows: CompetitorRow[] = raw
      .map((r) => ({
        handle: s(r.handle), followers: s(r.followers), topics: s(r.topics), formats: s(r.formats),
        what_works: s(r.what_works), tone: s(r.tone), posting: s(r.posting), strengths: s(r.strengths), takeaway: s(r.takeaway),
      }))
      .filter((r) => r.handle)

    if (rows.length === 0) return NextResponse.json({ error: 'Не удалось сделать анализ — попробуй ещё раз.' }, { status: 502 })
    return NextResponse.json({ competitors: rows })
  } catch (e) {
    console.error('[analyze-competitors]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}
