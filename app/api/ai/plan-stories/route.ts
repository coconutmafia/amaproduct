import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/client'
import { buildRAGContext } from '@/lib/ai/rag'
import { VISUAL_RULES } from '@/lib/ai/prompts/content-brain'

// Turns a story idea/script into a sequence of story FRAMES (minimal on-screen
// text per frame, in the blogger's voice) that the engine renders over their
// photos in their brand style. The "design layout" half of the stories feature.
export const maxDuration = 60

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

    const { projectId, script = '', count } = (await request.json()) as { projectId?: string; script?: string; count?: number }
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
    if (!script.trim()) return NextResponse.json({ error: 'Напиши сценарий/идею сторис' }, { status: 400 })

    const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).eq('owner_id', user.id).single()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const target = Math.max(3, Math.min(8, Number(count) || 5))

    let ragBlock = ''
    try {
      const rag = await buildRAGContext(script, projectId, 'stories')
      ragBlock = rag.projectContext.map((c) => c.chunk_text).join('\n\n').slice(0, 3500)
    } catch { /* no RAG */ }

    const prompt = `Ты — продюсер сторис для этого блогера. Разбей идею/сценарий ниже на последовательность из ~${target} сторис-кадров для Instagram (9:16).

${VISUAL_RULES}

ПРАВИЛА сторис:
- На каждом кадре МИНИМУМ текста (1-2 коротких строки, БЕЗ длинных оборотов) — сторис смотрят быстро.
- headline — главная фраза НА ЭКРАНЕ для этого кадра (хук/мысль), в голосе блогера. В headline или body выдели 1-2 САМЫХ важных слова двойными звёздочками **слово** — они станут акцентом фирменным цветом.
- body — опциональная короткая поддержка (можно пусто). Перечисление — короткими строками через перенос, не блоком.
- cta — опционально: призыв/стикер для кадра (напр. «листай дальше», «пиши + в директ», «опрос: да/нет», «ссылка в шапке»). Примерно в 20% кадров, не в каждом.
- position — где разместить текст на кадре: top / center / bottom. ЧЕРЕДУЙ позицию между кадрами (серия не должна выглядеть проштампованной одинаково); center используй редко, для самого важного кадра.
- Веди по нарастающей: первый кадр обязан ЗАЦЕПИТЬ → раскрыть → подвести к действию. Последний кадр — призыв.
- Голос и факты — ТОЛЬКО из материалов блогера ниже, не выдумывай.

ИДЕЯ/СЦЕНАРИЙ ОТ БЛОГЕРА:
${script.slice(0, 3000)}

МАТЕРИАЛЫ БЛОГЕРА (голос, аудитория, кейсы):
${ragBlock || '(мало материалов — опирайся на сценарий и его стиль)'}

Верни через инструмент plan_stories ровно ${target} кадров.`

    const tool = {
      name: 'plan_stories',
      description: 'Раскадровка сторис',
      input_schema: {
        type: 'object' as const,
        properties: {
          stories: {
            type: 'array',
            items: { type: 'object', properties: { headline: { type: 'string' }, body: { type: 'string' }, cta: { type: 'string' }, position: { type: 'string', description: 'top | center | bottom' } }, required: ['headline'] },
          },
        },
        required: ['stories'],
      },
    }

    let raw: Array<Record<string, unknown>> = []
    for (let attempt = 0; attempt < 3 && raw.length === 0; attempt++) {
      const res = await anthropic.messages.create({
        model: MODEL, max_tokens: 2000, tools: [tool],
        tool_choice: { type: 'tool' as const, name: 'plan_stories' },
        messages: [{ role: 'user', content: prompt }],
      })
      const block = res.content.find((b) => b.type === 'tool_use')
      if (block && block.type === 'tool_use') raw = toArray((block.input as { stories?: unknown }).stories) as Array<Record<string, unknown>>
    }

    const s = (v: unknown) => String(v ?? '').trim()
    const stories = raw
      .map((r, i) => {
        const p = s(r.position).toLowerCase()
        return {
          headline: s(r.headline), body: s(r.body), cta: s(r.cta),
          // Validate position; alternate as fallback so the series never stamps
          position: (['top', 'center', 'bottom'].includes(p) ? p : i % 2 === 0 ? 'bottom' : 'top') as 'top' | 'center' | 'bottom',
        }
      })
      .filter((r) => r.headline || r.body)
    if (stories.length === 0) return NextResponse.json({ error: 'Не удалось собрать сторис — попробуй ещё раз' }, { status: 502 })

    return NextResponse.json({ stories })
  } catch (e) {
    console.error('[plan-stories]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}
