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

    const { text, styleNotes } = (await request.json()) as { text?: string; type?: string; styleNotes?: string }
    if (!text || !text.trim()) return NextResponse.json({ error: 'Нет текста' }, { status: 400 })
    const notes = (styleNotes || '').trim().slice(0, 600)

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
    const prompt = `Вот ГОТОВЫЙ УТВЕРЖДЁННЫЙ текст карусели. Разложи его в структуру для рендера слайдов-картинок.

⛔ ГЛАВНОЕ ПРАВИЛО — ТЕКСТ МЕНЯТЬ НЕЛЬЗЯ: используй формулировки ДОСЛОВНО. Не переписывай, не сокращай, не «улучшай», не выбрасывай предложения и не добавляй свои. Если текста на слайд много — раздели на ДВА слайда по границе предложения, но не сокращай.
- cover — обложка (первый слайд): заголовок и подзаголовок — дословные фразы из текста (обычно первые).
- slides — остальные смысловые слайды по порядку: headline = фраза-тезис из текста (дословно), body = его текст (дословно). Если в тексте есть маркеры «Слайд N» — это готовые границы, используй ровно их.
- last_slide — финальный призыв (text + action) ТОЛЬКО если он написан в тексте — дословно. НИКАКОЙ отсебятины («пиши в директ» и т.п. не добавлять).
- Единственное, что МОЖНО добавить: выделение 1-2 КЛЮЧЕВЫХ слов слайда двойными звёздочками **слово** (акцент фирменным цветом) и переносы строк для перечислений.${notes ? `\n- ПОЖЕЛАНИЯ АВТОРА по выделению слов (учитывай: например «выделяй 2 слова», «не выделяй ничего»): ${notes}` : ''}

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
