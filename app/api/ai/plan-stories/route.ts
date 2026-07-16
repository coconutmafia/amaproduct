import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/client'
import { buildRAGContext } from '@/lib/ai/rag'
import { gateContentUnit, refundGeneration } from '@/lib/generations'
import { rateLimit } from '@/lib/rateLimit'
import { requireProjectAccess } from '@/lib/projects/access'

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
  let consumed = false
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await rateLimit(user.id, 'plan-stories')
    if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

    const { projectId, script = '', count } = (await request.json()) as { projectId?: string; script?: string; count?: number }
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
    if (!script.trim()) return NextResponse.json({ error: 'Напиши сценарий/идею сторис' }, { status: 400 })

    const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    // A story series is a content unit (it lays out a full storyboard).
    const gate = await gateContentUnit(user.id)
    if (gate.blocked) {
      // Неоплатившему — «подключи тариф», а не «лимит исчерпан» (у него 0 создано).
      const code = gate.reason === 'not_entitled' ? 'payment_required' : 'limit_reached'
      return NextResponse.json({ error: code, code, monthlyUsed: gate.monthlyUsed, monthlyLimit: gate.monthlyLimit }, { status: 402 })
    }
    consumed = true

    const target = Math.max(3, Math.min(8, Number(count) || 5))

    let ragBlock = ''
    try {
      const rag = await buildRAGContext(script, projectId, 'stories')
      ragBlock = rag.projectContext.map((c) => c.chunk_text).join('\n\n').slice(0, 3500)
    } catch { /* no RAG */ }

    const prompt = `Ты — раскладчик сторис для этого блогера. Разложи его ГОТОВЫЙ текст ниже на кадры сторис для Instagram (9:16).

⛔ ГЛАВНОЕ ПРАВИЛО — ТЕКСТ УТВЕРЖДЁН, МЕНЯТЬ ЕГО НЕЛЬЗЯ:
- Используй формулировки блогера ДОСЛОВНО. НИ ОДНОГО нового слова, НИ одного переписанного или выброшенного предложения. Не сокращай, не «улучшай», не пересказывай.
- Если в тексте есть маркеры «Сторис N» / «Кадр N» — это ГОТОВЫЕ границы кадров: используй ровно эти кадры и их текст дословно (маркеры и подписи типа «(хук)» в текст кадра не включай).
- Если маркеров нет — режь на кадры ПО ГРАНИЦАМ предложений/абзацев, ничего не меняя внутри.
- Если текст кадра длинный — НЕ сокращай: раздели его на два кадра (по границе предложения).
- Единственное, что МОЖНО добавить: выделение 1-2 ключевых слов кадра двойными звёздочками **слово** (станут акцентом фирменным цветом) и переносы строк для перечислений.

Структура кадра:
- headline — первая фраза/мысль кадра (дословно из текста).
- body — остальной текст кадра (дословно; можно пусто).
- cta — ТОЛЬКО если призыв/опрос/вопрос аудитории НАПИСАН в тексте блогера — тогда перенеси его сюда ДОСЛОВНО. НИКАКОЙ отсебятины: не добавляй «листай дальше», «пиши в директ», «ответь мне» и т.п. Нет призыва в тексте — cta пустой.
- position — top / center / bottom (подсказка; финально подбирается по фото).

УТВЕРЖДЁННЫЙ ТЕКСТ БЛОГЕРА:
${script.slice(0, 3000)}

КОНТЕКСТ ПРО БЛОГЕРА (только для понимания, КАКИЕ слова выделять акцентом — НЕ для дописывания текста):
${ragBlock || '(мало материалов)'}

Верни кадры через инструмент plan_stories (ориентир ~${target} кадров; если в тексте маркеры «Сторис N» — ровно по ним).`

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
    // HARD guards against invented content (prompt alone wasn't enough — the
    // owner kept getting «пиши в директ» из ниоткуда даже после запрета):
    //  • cta survives only if it actually appears in the blogger's own text;
    //  • known CTA phrases are stripped from headline/body too unless present
    //    in the script;
    //  • the LAST frame additionally drops trailing sentences absent from the
    //    script (that's where the model liked to append a call-to-action).
    const norm = (t: string) => t.toLowerCase().replace(/\*\*/g, '').replace(/[^а-яёa-z0-9+\s]/gi, ' ').replace(/\s+/g, ' ').trim()
    const scriptN = norm(script)
    const inScript = (t: string): boolean => {
      const c = norm(t)
      if (!c) return false
      if (scriptN.includes(c)) return true
      const words = c.split(' ').filter((w) => w.length > 2)
      if (words.length === 0) return false
      const hit = words.filter((w) => scriptN.includes(w)).length
      return hit / words.length >= 0.7
    }
    const CTA_BLACKLIST = /(пиши|напиши|ответь|отвечай)[^.!?\n]{0,25}(директ|комментар|мне)|листай дальше|смотри до конца|ссылка в шапке|жми[^.!?\n]{0,20}(❤|🤍|сердеч|огон|плюс|\+)/i
    const splitSentences = (t: string) => t.split(/\n+|(?<=[.!?…])\s+/).map((x) => x.trim()).filter(Boolean)
    const stripInvented = (t: string, lastFrame: boolean): string => {
      if (!t) return t
      const kept = splitSentences(t).filter((sent) => {
        if (CTA_BLACKLIST.test(sent) && !inScript(sent)) return false
        if (lastFrame && !inScript(sent)) return false
        return true
      })
      return kept.length > 0 ? kept.join('\n') : (lastFrame ? '' : t)
    }
    const stories = raw
      .map((r, i) => {
        const p = s(r.position).toLowerCase()
        const last = i === raw.length - 1
        return {
          headline: stripInvented(s(r.headline), last),
          body: stripInvented(s(r.body), last),
          cta: inScript(s(r.cta)) ? s(r.cta) : '',
          // Validate position; alternate as fallback so the series never stamps
          position: (['top', 'center', 'bottom'].includes(p) ? p : i % 2 === 0 ? 'bottom' : 'top') as 'top' | 'center' | 'bottom',
        }
      })
      .filter((r) => r.headline || r.body)
    if (stories.length === 0) {
      if (consumed) await refundGeneration(user.id)
      return NextResponse.json({ error: 'Не удалось собрать сторис — попробуй ещё раз' }, { status: 502 })
    }

    return NextResponse.json({ stories })
  } catch (e) {
    console.error('[plan-stories]', e instanceof Error ? e.message : e)
    if (consumed) {
      try {
        const sb = await createClient()
        const { data: { user: u } } = await sb.auth.getUser()
        if (u) await refundGeneration(u.id)
      } catch { /* ignore */ }
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}
