import { createClient } from '@/lib/supabase/server'
import { upsertProjectMaterial } from '@/lib/supabase/upsertMaterial'
import { anthropic, MODEL } from '@/lib/ai/client'
import { requireProjectAccess } from '@/lib/projects/access'
import { NextResponse } from 'next/server'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

const TOV_SYSTEM = `Ты — эксперт по анализу авторского голоса.
На вход тебе дают тексты, которые автор писал САМ, без AI.
Твоя задача — извлечь его настоящий Tone of Voice как эталон стиля.`

function buildPrompt(units: string[]): string {
  const samples = units
    .map((u, i) => `=== ОБРАЗЕЦ ${i + 1} ===\n${u.trim()}`)
    .join('\n\n')

  return `Проанализируй ${units.length} текстов одного автора и опиши его Tone of Voice так,
чтобы по этому описанию можно было воспроизвести его голос при генерации нового контента.

${samples}

СТРУКТУРА ОТВЕТА (в свободной форме, на русском, прозой, с подзаголовками):

## Общая характеристика
- формальный / разговорный / смешанный
- эмоциональный / сдержанный
- кто автор в текстах (эксперт, друг, ментор, провокатор и т.д.)

## Лексика
- слова и обороты, которые автор реально использует (выпиши 10-20 живых примеров из текстов)
- любимые слова-связки

## Структура и ритм
- длина предложений, ритм
- абзацы, отступы, паузы

## Эмоция и подача
- какие эмоции транслирует и как
- использование эмодзи, восклицаний, заглавных, метафор

## Табу
- слова и темы, которых автор избегает
- стилистические приёмы, которые ему НЕ свойственны

## Фирменные приёмы
- характерные обороты, повторяющиеся конструкции, любые «отпечатки» голоса

Пиши кратко и по делу. Без JSON и markdown-code-блоков — просто текст с подзаголовками.`
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { projectId?: string; units?: string[] }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const { projectId, units } = body
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  const clean = (units ?? []).map(u => (u ?? '').trim()).filter(u => u.length >= 30)
  if (clean.length < 3) {
    return NextResponse.json({ error: 'Нужно минимум 3 текста по 30+ символов каждый. Желательно 7-10, написанных тобой лично.' }, { status: 400 })
  }

  const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const TOV_TITLE = 'Tone of Voice (извлечён из твоих текстов)'

  // ── Save the user's own posts as STYLE EXAMPLES (few-shot anchors) ─────────
  // This is the strongest voice lever: the generator's "пиши ИМЕННО ТАК"
  // section uses real approved posts. Pasting posts here previously only fed
  // a TOV *description* — the actual texts were never used verbatim. Now each
  // post becomes a style example, so generated content matches her real voice.
  try {
    // Refresh: drop previously imported "from texts" examples, re-add current set
    await supabase.from('style_examples')
      .delete()
      .eq('project_id', projectId)
      .eq('title', 'Мой текст (эталон стиля)')
    const rows = clean.slice(0, 10).map(text => ({
      project_id:        projectId,
      content_type:      'post',
      title:             'Мой текст (эталон стиля)',
      body_text:         text,
      performance_score: 100, // user's own writing — highest priority
      is_active:         true,
      is_system:         false,
    }))
    if (rows.length > 0) await supabase.from('style_examples').insert(rows)
  } catch (e) {
    console.error('[extract-tone-of-voice] style example save failed:', e)
  }

  // Placeholder so the user sees the request reached the server. Survives
  // mobile drops, tab close, etc.
  try {
    await upsertProjectMaterial(supabase, {
      project_id:        projectId,
      title:             TOV_TITLE,
      material_type:     'tone_of_voice',
      raw_content:       '⏳ Tone of Voice анализируется… Если эта надпись висит дольше 3 минут — что-то пошло не так, попробуй ещё раз.',
      processing_status: 'processing',
    })
  } catch { /* swallow */ }

  // SSE stream with keepalive — mobile networks kill silent connections.
  const encoder = new TextEncoder()
  const stream  = new ReadableStream({
    async start(controller) {
      let closed = false
      const push = (s: string) => { if (!closed) { try { controller.enqueue(encoder.encode(s)) } catch { closed = true } } }
      const send = (d: Record<string, unknown>) => push(`data: ${JSON.stringify(d)}\n\n`)
      push(': open\n\n')
      const ping = setInterval(() => push(': ping\n\n'), 10000)

      try {
        send({ type: 'status', message: 'Анализирую твои тексты и собираю Tone of Voice...' })

        const aiStream = anthropic.messages.stream({
          model:      MODEL,
          max_tokens: 4000,
          system:     TOV_SYSTEM,
          messages:   [{ role: 'user', content: buildPrompt(clean) }],
        })
        for await (const chunk of aiStream) {
          if (chunk.type === 'content_block_delta') send({ type: 'progress' })
        }
        const finalMsg = await aiStream.finalMessage()
        const text = finalMsg.content
          .map(b => (b.type === 'text' ? b.text : ''))
          .join('\n')
          .trim()

        if (!text || text.length < 80) {
          const blockTypes = finalMsg.content.map(b => b.type).join(',') || 'НЕТ БЛОКОВ'
          const diagnostic = [
            `❌ Не удалось извлечь Tone of Voice`,
            ``,
            `Причина: AI вернул пустой / слишком короткий ответ.`,
            `stop_reason: ${finalMsg.stop_reason}`,
            `Типы блоков: [${blockTypes}]`,
            `Длина текстового ответа: ${text.length} символов`,
            ``,
            `─── Полный ответ AI (первые 4000 символов) ───`,
            text.slice(0, 4000) || '(пусто)',
          ].join('\n')
          try {
            await upsertProjectMaterial(supabase, {
              project_id:        projectId,
              title:             TOV_TITLE,
              material_type:     'tone_of_voice',
              raw_content:       diagnostic,
              processing_status: 'error',
            })
          } catch { /* swallow */ }
          send({ type: 'error', message: 'Не удалось извлечь ToV. Открой материал «Tone of Voice (извлечён из твоих текстов)» — там полная диагностика.' })
          return
        }

        const { error: saveErr } = await upsertProjectMaterial(supabase, {
          project_id:        projectId,
          title:             TOV_TITLE,
          material_type:     'tone_of_voice',
          raw_content:       text,
          processing_status: 'ready',
        })

        if (saveErr) {
          console.error('[extract-tone-of-voice] save error:', saveErr)
          send({ type: 'error', message: `Tone of Voice собран, но не сохранился: ${saveErr.message}` })
          return
        }

        send({ type: 'done' })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'AI недоступен'
        console.error('[extract-tone-of-voice] error:', msg)
        try {
          await upsertProjectMaterial(supabase, {
            project_id:        projectId,
            title:             TOV_TITLE,
            material_type:     'tone_of_voice',
            raw_content:       `❌ Ошибка извлечения Tone of Voice\n\n${msg}\n\n(Стек: ${err instanceof Error && err.stack ? err.stack.slice(0, 1500) : 'нет'})`,
            processing_status: 'error',
          })
        } catch { /* swallow */ }
        send({ type: 'error', message: msg })
      } finally {
        clearInterval(ping)
        closed = true
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':           'text/event-stream',
      'Cache-Control':          'no-cache, no-transform',
      'X-Accel-Buffering':      'no',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
