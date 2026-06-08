import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL_SONNET } from '@/lib/ai/client'

// Bridges chat-generated TEXT → the structured carousel shape the slide renderer
// needs. The chat produces clean text (no JSON by design), so when the user wants
// real slide images we structure that text here (no new content invented — only
// reshaped), marking key phrases with **…** so the engine highlights them.
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

    const { text } = (await request.json()) as { text?: string; type?: string }
    if (!text || !text.trim()) return NextResponse.json({ error: 'Нет текста' }, { status: 400 })

    const tool = {
      name: 'structure_carousel',
      description: 'Структура карусели для рендера слайдов',
      input_schema: {
        type: 'object' as const,
        properties: {
          cover: { type: 'object', properties: { headline: { type: 'string' }, subheadline: { type: 'string' }, emoji: { type: 'string' } }, required: ['headline'] },
          slides: { type: 'array', items: { type: 'object', properties: { headline: { type: 'string' }, body: { type: 'string' }, emoji: { type: 'string' } } } },
          last_slide: { type: 'object', properties: { text: { type: 'string' }, action: { type: 'string' } } },
        },
        required: ['cover', 'slides'],
      },
    }
    const prompt = `Вот ГОТОВЫЙ текст карусели. Разложи его в структуру для рендера слайдов-картинок. НЕ добавляй и не выдумывай новый контент — только аккуратно структурируй то, что есть.
- cover — обложка (первый слайд): сильный заголовок + подзаголовок.
- slides — остальные смысловые слайды по порядку: короткий заголовок + текст слайда.
- last_slide — финальный призыв (text + action), если он есть в тексте.
- В заголовках/тексте выдели 1-2 КЛЮЧЕВЫХ слова двойными звёздочками **слово** для акцента.
- Тексты делай короткими и читаемыми на картинке (без лишней воды), но смысл сохрани.

ТЕКСТ КАРУСЕЛИ:
${text.slice(0, 6000)}

Верни через инструмент structure_carousel.`

    let carousel: Record<string, unknown> | null = null
    for (let attempt = 0; attempt < 3 && !carousel; attempt++) {
      const res = await anthropic.messages.create({
        model: MODEL_SONNET, // structuring (not flagship creative) → fast/cheap is fine
        max_tokens: 3000,
        tools: [tool],
        tool_choice: { type: 'tool' as const, name: 'structure_carousel' },
        messages: [{ role: 'user', content: prompt }],
      })
      const block = res.content.find((b) => b.type === 'tool_use')
      if (block && block.type === 'tool_use') {
        const input = block.input as Record<string, unknown>
        const slides = toArray(input.slides)
        if (input.cover && slides.length > 0) carousel = { cover: input.cover, slides, last_slide: input.last_slide, total_slides: 1 + slides.length + (input.last_slide ? 1 : 0) }
      }
    }
    if (!carousel) return NextResponse.json({ error: 'Не удалось разложить на слайды — попробуй ещё раз' }, { status: 502 })
    return NextResponse.json({ carousel })
  } catch (e) {
    console.error('[carousel/structure]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}
