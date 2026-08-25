import { NextResponse } from 'next/server'
import { captureException } from '@/lib/sentry'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rateLimit'
import { requirePaidAccess } from '@/lib/billing/access'
import { gateMicroAction } from '@/lib/ai/usage'
import { anthropic, MODEL, AI_BUSY_MESSAGE } from '@/lib/ai/client'
import { getAiTells, resolveContentLanguage } from '@/lib/ai/prompts/content-brain'
import { buildRAGContext } from '@/lib/ai/rag'
import { requireProjectAccess } from '@/lib/projects/access'

// Proactive content angles: when the user opens the assistant from the content
// plan to make a unit, suggest 2-3 distinct ways to approach the day's topic —
// grounded in the blogger's own materials (audience pains, cases, voice). For
// reels, also adapt a current trend to the topic. Returns a clean opener text.
export const maxDuration = 60

const TYPE_RU: Record<string, string> = { post: 'пост', stories: 'сторис', reels: 'рилз', carousel: 'карусель', email: 'письмо', live: 'эфир' }
const PHASE_RU: Record<string, string> = {
  niche: 'прогрев на нишу', expert: 'прогрев на эксперта', product: 'прогрев на продукт', objections: 'отработка возражений',
  awareness: 'знакомство', trust: 'доверие', desire: 'желание', close: 'закрытие',
  phase_1: 'прогрев на нишу', phase_2: 'прогрев на эксперта', phase_3: 'прогрев на продукт', phase_4: 'отработка возражений',
}

function toArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await rateLimit(user.id, 'suggest-angles')
    if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

    const denied = await requirePaidAccess(user.id)
    if (denied) return denied

    // Мелкое AI-действие (прайс-лист 25.08): 10 шт. = 1 юнит. Гейт после
    // requirePaidAccess — not_entitled уже отсечён, здесь только quota.
    const micro = await gateMicroAction(user.id, 'suggest-angles')
    if (micro.blocked) {
      return NextResponse.json({ error: 'limit_reached', code: 'limit_reached' }, { status: 402 })
    }

    const { projectId, type = 'post', brief = '', phase = '' } = (await request.json()) as
      { projectId?: string; type?: string; brief?: string; phase?: string; day?: number }
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

    const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    // select('*'), НЕ явный список: до наката 038 колонки content_language нет,
    // явный select ронял роут 404 для всех (пойман doubt-check живьём на проде).
    const { data: project } = await supabase.from('projects').select('*').eq('id', projectId).single()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    // Хук — это контент (фраза в кадре/в тексте): для блога на другом языке он
    // обязан быть на языке блога, даже если разговор и «почему зайдёт» русские.
    const contentLang = resolveContentLanguage(project as { content_language?: string | null })

    const ru = TYPE_RU[type] || type
    const phaseLabel = PHASE_RU[phase] || phase

    // Blogger's materials (audience pains, cases, voice) for grounded angles.
    let ragBlock = ''
    try {
      const rag = await buildRAGContext(brief || 'тема дня', projectId, type)
      ragBlock = rag.projectContext.map((c) => c.chunk_text).join('\n\n').slice(0, 4500)
    } catch { /* no RAG */ }

    // Trends (niche-matched) — used to adapt a reel trend to the topic.
    let trendsBlock = ''
    if (type === 'reels' || type === 'carousel') {
      try {
        const niche = (project.niche || '').toLowerCase()
        const { data: tr } = await supabase
          .from('content_trends')
          .select('title, description, niches, scope, project_id, is_active')
          .eq('is_active', true)
          .limit(40)
        const matched = (tr ?? [])
          .filter((t) => t.scope === 'system' || (t.scope === 'project' && t.project_id === projectId))
          .filter((t) => { const ns = (t.niches as string[] | null) ?? []; return ns.length === 0 || !niche || ns.some((n) => niche.includes(String(n).toLowerCase()) || String(n).toLowerCase().includes(niche)) })
          .slice(0, 8)
        trendsBlock = matched.map((t) => `• ${t.title}: ${t.description}`).join('\n')
      } catch { /* no trends */ }
    }

    const prompt = `Ты — продюсер контента для этого блогера. Он идёт создавать ${ru} на тему «${brief || 'тема дня'}»${phaseLabel ? ` (этап: ${phaseLabel})` : ''}. Предложи 2-3 РАЗНЫХ захода/угла, как подать эту тему, чтобы зацепить ЕГО аудиторию.

Для каждого угла:
- approach — формат/угол кратко (напр. «Личная история про провал», «Разбор мифа», «Чек-лист из 3 шагов»)
- hook — конкретная первая фраза/заход В ЕГО ГОЛОСЕ
- why — почему зайдёт, 1 фраза со ссылкой на реальную боль/желание его аудитории из материалов${type === 'reels' ? '\n\nТакже верни reel_trend — актуальную механику/тренд рилза, адаптированную под эту тему.' : ''}

ОПИРАЙСЯ на материалы блогера ниже (боли/желания аудитории, кейсы, голос). НЕ выдумывай факты, цифры и кейсы, которых там нет.

${getAiTells(contentLang)}

⚠️ Особенно для hook: это фраза, которую блогер скажет В КАДРЕ — проговори её вслух, никаких рубленых обрубков через точку.${contentLang && contentLang !== 'ru' ? `\n⚠️ ЯЗЫК: hook и reel_trend-механику пиши на языке блога (${contentLang === 'en' ? 'английском' : contentLang === 'es' ? 'испанском' : 'немецком'}) — это контент. approach и why — по-русски (это разговор с блогером).` : ''}

МАТЕРИАЛЫ БЛОГЕРА:
${ragBlock || '(материалов мало — опирайся на тему и проверенные форматы)'}
${trendsBlock ? `\nАКТУАЛЬНЫЕ ТРЕНДЫ (для рилза можно адаптировать):\n${trendsBlock}` : ''}

Верни через инструмент propose_angles.`

    const tool = {
      name: 'propose_angles',
      description: 'Варианты захода на тему',
      input_schema: {
        type: 'object' as const,
        properties: {
          angles: {
            type: 'array',
            items: { type: 'object', properties: { approach: { type: 'string' }, hook: { type: 'string' }, why: { type: 'string' } }, required: ['approach', 'hook'] },
          },
          reel_trend: { type: 'string' },
        },
        required: ['angles'],
      },
    }

    let angles: Array<Record<string, unknown>> = []
    let reelTrend = ''
    for (let attempt = 0; attempt < 3 && angles.length === 0; attempt++) {
      const res = await anthropic.messages.create({
        model: MODEL, max_tokens: 4000, tools: [tool],
        tool_choice: { type: 'tool' as const, name: 'propose_angles' },
        messages: [{ role: 'user', content: prompt }],
      })
      const block = res.content.find((b) => b.type === 'tool_use')
      if (block && block.type === 'tool_use') {
        const input = block.input as { angles?: unknown; reel_trend?: unknown }
        angles = toArray(input.angles) as Array<Record<string, unknown>>
        reelTrend = String(input.reel_trend ?? '').trim()
      }
    }

    const s = (v: unknown) => String(v ?? '').trim()
    const clean = angles.map((a) => ({ approach: s(a.approach), hook: s(a.hook), why: s(a.why) })).filter((a) => a.approach || a.hook).slice(0, 3)
    if (clean.length === 0) return NextResponse.json({ error: 'no angles' }, { status: 502 })

    const lines = clean.map((a, i) => {
      const parts = [`${i + 1}) ${a.approach}`]
      if (a.hook) parts.push(`   Заход: «${a.hook}»`)
      if (a.why) parts.push(`   Почему зайдёт: ${a.why}`)
      return parts.join('\n')
    })
    let text = `Вот пара вариантов, с чего можно зайти:\n\n${lines.join('\n\n')}`
    if (reelTrend) text += `\n\nДля рилза можно обыграть тренд: ${reelTrend}`
    text += `\n\nКакой вариант берём? Или добавь свои детали — историю, цифры, имя клиента — и я напишу.`

    return NextResponse.json({ text })
  } catch (e) {
    console.error('[suggest-angles]', e instanceof Error ? e.message : e)
    await captureException(e, { where: 'suggest-angles' })
    return NextResponse.json({ error: AI_BUSY_MESSAGE }, { status: 503 })
  }
}
