import { NextResponse } from 'next/server'
import { captureException } from '@/lib/sentry'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rateLimit'
import { requirePaidAccess } from '@/lib/billing/access'
import { gateMicroAction } from '@/lib/ai/usage'
import { anthropic, MODEL, AI_BUSY_MESSAGE } from '@/lib/ai/client'
import { getAiTells, detectTextLanguage, VISUAL_RULES } from '@/lib/ai/prompts/content-brain'

// Chat/voice edits to already-rendered carousel slides (owner: «подредактировать
// не могу, только скачать как есть»). Takes the structured carousel + a free-form
// instruction, returns the SAME structure back with only the requested changes.
export const maxDuration = 60

type Dict = Record<string, unknown>

function toArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}
const str = (v: unknown) => String(v ?? '').trim()

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await rateLimit(user.id, 'edit')
    if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

    const denied = await requirePaidAccess(user.id)
    if (denied) return denied

    const { carousel, instruction } = (await request.json()) as { carousel?: Dict; instruction?: string }
    if (!carousel || !carousel.cover) return NextResponse.json({ error: 'Нет карусели для правки' }, { status: 400 })
    if (!instruction || !instruction.trim()) return NextResponse.json({ error: 'Скажи, что поменять' }, { status: 400 })

    // Мелкое AI-действие (прайс-лист 25.08): 10 шт. = 1 юнит.
    // СТОИТ ПОСЛЕ валидации намеренно: за отбитый 400 «нет текста»/«нет
    // проекта» считать нельзя — работа не делалась (у Иры 17.08 таких
    // отбитых попыток было 9 подряд).
    const micro = await gateMicroAction(user.id, 'edit-carousel')
    if (micro.blocked) {
      return NextResponse.json({ error: 'limit_reached', code: 'limit_reached' }, { status: 402 })
    }

    const cover = (carousel.cover ?? {}) as Dict
    const slides = toArray(carousel.slides) as Dict[]
    const last = (carousel.last_slide ?? null) as Dict | null
    const current = [
      `Слайд 1 (обложка):\n  headline: ${str(cover.headline)}\n  subheadline: ${str(cover.subheadline)}`,
      ...slides.map((sl, i) => `Слайд ${i + 2}:\n  headline: ${str(sl.headline)}\n  body: ${str(sl.body)}`),
      ...(last ? [`Финальный слайд:\n  text: ${str(last.text)}\n  action: ${str(last.action)}`] : []),
    ].join('\n')
    // Язык детектим по ЗНАЧЕНИЯМ слайдов (без «Слайд/headline:»-скелета — его
    // латинские ключи и русские метки искажают долю латиницы)
    const valuesOnly = [
      str(cover.headline), str(cover.subheadline),
      ...slides.flatMap((sl) => [str(sl.headline), str(sl.body)]),
      ...(last ? [str(last.text), str(last.action)] : []),
    ].join(' ')

    const prompt = `Ты — продюсер каруселей. Блогер уже собрал слайды карусели и просит внести ПРАВКУ (часто надиктована голосом, может ссылаться на номер слайда).

ТЕКУЩИЕ СЛАЙДЫ:
${current}

ПРАВКА ОТ БЛОГЕРА:
${instruction.slice(0, 1500)}

ПРАВИЛА:
- Меняй ТОЛЬКО то, о чём просят. Остальные слайды и поля верни ДОСЛОВНО как были (включая **акценты**).
- Количество слайдов НЕ меняй, если прямо не попросили добавить/убрать слайд.
- Можно менять: тексты, выделение **слов** акцентом, разбивку фраз (переносом строки), сокращать/удлинять.
- Если просят перенести/не разрывать число или фразу — переформулируй строку так, чтобы она легла целиком.
- ЯЗЫК СЛАЙДОВ НЕ МЕНЯЙ: правки пиши на языке самих слайдов (английские слайды → английские правки), даже если просьба блогера на другом языке. Переводить слайды можно только если об этом прямо попросили.
${VISUAL_RULES}
${getAiTells(detectTextLanguage(valuesOnly))}

Верни ПОЛНУЮ обновлённую карусель через инструмент edit_carousel.`

    const tool = {
      name: 'edit_carousel',
      description: 'Обновлённая структура карусели',
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

    let out: Dict | null = null
    for (let attempt = 0; attempt < 3 && !out; attempt++) {
      const res = await anthropic.messages.create({
        model: MODEL, max_tokens: 8000, tools: [tool],
        tool_choice: { type: 'tool' as const, name: 'edit_carousel' },
        messages: [{ role: 'user', content: prompt }],
      })
      const block = res.content.find((b) => b.type === 'tool_use')
      if (block && block.type === 'tool_use') {
        const input = block.input as Dict
        const newSlides = toArray(input.slides)
        if (input.cover && newSlides.length > 0) {
          out = { cover: input.cover, slides: newSlides, last_slide: input.last_slide ?? last ?? undefined, total_slides: 1 + newSlides.length + (input.last_slide || last ? 1 : 0) }
        }
      }
    }
    if (!out) return NextResponse.json({ error: 'Не удалось применить правку — попробуй сформулировать иначе' }, { status: 502 })

    // СТРАЖ ПОТЕРИ СЛАЙДОВ (класс edit-stories, Станислав 25.08): усечённый
    // ответ с меньшим числом слайдов без явной просьбы удалить — не отдаём,
    // иначе клиент перерендерит карусель урезанной.
    const deleteIntent = /удали|убер|сотри|remove|delete/i.test(instruction)
    const outSlides = toArray((out as Dict).slides)
    if (outSlides.length < slides.length && !deleteIntent) {
      await captureException(new Error(`edit-carousel вернул ${outSlides.length} слайдов вместо ${slides.length}`), { where: 'edit-carousel count-guard' })
      return NextResponse.json({ error: `Правка вернула ${outSlides.length} слайдов вместо ${slides.length} — ничего не меняю, чтобы не потерять слайды. Попробуй сформулировать точнее.` }, { status: 502 })
    }

    return NextResponse.json({ carousel: out })
  } catch (e) {
    console.error('[edit-carousel]', e instanceof Error ? e.message : e)
    await captureException(e, { where: 'edit-carousel' })
    return NextResponse.json({ error: AI_BUSY_MESSAGE }, { status: 503 })
  }
}
