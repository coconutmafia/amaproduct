import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rateLimit'
import { anthropic, MODEL } from '@/lib/ai/client'
import { AI_TELLS_TO_AVOID, VISUAL_RULES } from '@/lib/ai/prompts/content-brain'
import { requireProjectAccess } from '@/lib/projects/access'

// Chat/voice edits to an already-designed stories series («на третьей сторис
// поменяй…», owner request). Takes the current frames + a free-form instruction
// (often dictated), returns the FULL updated frames array — only what was asked
// changes, everything else returns byte-identical.
export const maxDuration = 60

interface Frame { headline?: string; body?: string; cta?: string; position?: string; plate?: boolean }

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

    const rl = await rateLimit(user.id, 'edit')
    if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

    const { projectId, frames, instruction } = (await request.json()) as { projectId?: string; frames?: Frame[]; instruction?: string }
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
    if (!frames || frames.length === 0) return NextResponse.json({ error: 'Нет кадров для правки' }, { status: 400 })
    if (!instruction || !instruction.trim()) return NextResponse.json({ error: 'Скажи, что поменять' }, { status: 400 })

    // AI generation costs real money and has no RLS-gated write here — check
    // editor+ explicitly.
    const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    const current = frames.map((f, i) =>
      `Кадр ${i + 1} (position: ${f.position || 'auto'}, подложка: ${f.plate === false ? 'без' : 'с подложкой'}):\n  headline: ${f.headline || ''}\n  body: ${f.body || ''}\n  cta: ${f.cta || ''}`
    ).join('\n')

    const prompt = `Ты — продюсер сторис. Блогер уже собрал серию сторис-кадров и просит внести ПРАВКУ (часто надиктована голосом, может ссылаться на номер кадра: «на третьей», «в последнем»).

ТЕКУЩИЕ КАДРЫ:
${current}

ПРАВКА ОТ БЛОГЕРА:
${instruction.slice(0, 1500)}

ПРАВИЛА:
- Меняй ТОЛЬКО то, о чём просят. Остальные кадры и поля верни ДОСЛОВНО как были (включая **акценты**).
- Количество кадров НЕ меняй, если прямо не попросили добавить/убрать кадр.
- Можно менять: тексты, выделение **слов** акцентом, расположение текста (position: top | center | bottom), подложку (plate: "with" — текст на плашках, "without" — чистый текст без плашек).
- position указывай ТОЛЬКО для кадров, где просили её поменять; для остальных верни как было. plate указывай ТОЛЬКО если просили про подложку целиком — иначе оставь пустым.
- ПОДЛОЖКА ТОЧЕЧНО (важно): если просят выделить подложкой ТОЛЬКО конкретный фрагмент — предложение или слово («выдели подложкой только первое предложение», «подложку только под словом X», «оставь плашку только на хуке») — оберни РОВНО этот фрагмент в двойные квадратные скобки [[ ... ]] прямо внутри headline или body, а весь остальной текст оставь БЕЗ скобок. Тогда подложка ляжет только под обёрнутый фрагмент, остальное — чистым текстом на фото. Слова внутри скобок НЕ меняй (можно сохранить **акцент** внутри). В этом случае поле plate оставь пустым (скобки управляют подложкой). Если просят «убери выделение/плашки везде» — удали все [[ ]] и верни plate "without"; «подложку под весь текст» — удали все [[ ]] и верни plate "with".
- УБРАТЬ ПРИЗЫВ/КНОПКУ: если просят убрать призыв / CTA / «розовую кнопку-фразу» / «розовую подложку с последней фразы» на кадре — верни для ЭТОГО кадра поле cta ПУСТЫМ (пустая строка) и НЕ возвращай его обратно. Розовая «кнопка» внизу кадра = это cta.
- Если просят «короче/другими словами» — правь только указанный кадр (или все, если сказано «везде»).
${VISUAL_RULES}
${AI_TELLS_TO_AVOID}

Верни ПОЛНЫЙ обновлённый список кадров через инструмент edit_stories (по одному элементу на каждый кадр, в том же порядке).`

    const tool = {
      name: 'edit_stories',
      description: 'Обновлённая раскадровка сторис',
      input_schema: {
        type: 'object' as const,
        properties: {
          stories: {
            type: 'array',
            items: { type: 'object', properties: { headline: { type: 'string' }, body: { type: 'string' }, cta: { type: 'string' }, position: { type: 'string', description: 'top | center | bottom' }, plate: { type: 'string', description: 'with | without — только если просили менять подложку, иначе пусто' } }, required: ['headline'] },
          },
        },
        required: ['stories'],
      },
    }

    let raw: Array<Record<string, unknown>> = []
    for (let attempt = 0; attempt < 3 && raw.length === 0; attempt++) {
      const res = await anthropic.messages.create({
        model: MODEL, max_tokens: 2500, tools: [tool],
        tool_choice: { type: 'tool' as const, name: 'edit_stories' },
        messages: [{ role: 'user', content: prompt }],
      })
      const block = res.content.find((b) => b.type === 'tool_use')
      if (block && block.type === 'tool_use') raw = toArray((block.input as { stories?: unknown }).stories) as Array<Record<string, unknown>>
    }

    const s = (v: unknown) => String(v ?? '').trim()
    const out = raw
      .map((r, i) => {
        const p = s(r.position).toLowerCase()
        const plateRaw = s(r.plate).toLowerCase()
        const prev = frames[i] || {}
        return {
          headline: s(r.headline), body: s(r.body), cta: s(r.cta),
          position: (['top', 'center', 'bottom'].includes(p) ? p : prev.position) as 'top' | 'center' | 'bottom' | undefined,
          // plate present only when the user asked about it
          ...(plateRaw === 'with' ? { plate: true } : plateRaw === 'without' ? { plate: false } : {}),
        }
      })
      .filter((r) => r.headline || r.body)
    if (out.length === 0) return NextResponse.json({ error: 'Не удалось применить правку — попробуй сформулировать иначе' }, { status: 502 })

    return NextResponse.json({ stories: out })
  } catch (e) {
    console.error('[edit-stories]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}
