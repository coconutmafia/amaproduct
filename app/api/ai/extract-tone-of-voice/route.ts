import { createClient } from '@/lib/supabase/server'
import { captureException } from '@/lib/sentry'
import { rateLimit } from '@/lib/rateLimit'
import { requirePaidAccess } from '@/lib/billing/access'
import { upsertProjectMaterial } from '@/lib/supabase/upsertMaterial'
import { anthropic, MODEL } from '@/lib/ai/client'
import { requireProjectAccess } from '@/lib/projects/access'
import { resolveContentLanguage, type ContentLanguage } from '@/lib/ai/prompts/content-brain'
import { NextResponse, after } from 'next/server'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

const TOV_SYSTEM = `Ты — эксперт по анализу авторского голоса.
На вход тебе дают тексты, которые автор писал САМ, без AI.
Твоя задача — извлечь его настоящий Tone of Voice как эталон стиля.`

// Язык описания ToV = язык контента блога (настройка проекта; без неё — язык
// самих текстов). Это несущая деталь: генераторы без явной настройки берут
// язык ответа «как у TOV» — русское описание английского голоса заставляло бы
// весь контент говорить по-русски. Фирменные обороты — ВСЕГДА дословно на
// языке автора: переведённая цитата перестаёт быть якорем голоса.
function buildPrompt(units: string[], lang: ContentLanguage | 'auto'): string {
  const samples = units
    .map((u, i) => `=== ОБРАЗЕЦ ${i + 1} ===\n${u.trim()}`)
    .join('\n\n')

  const langLine = lang === 'en'
    ? 'НА АНГЛИЙСКОМ ЯЗЫКЕ (блог автора английский — описание голоса тоже английское)'
    : lang === 'es'
    ? 'НА ИСПАНСКОМ ЯЗЫКЕ (блог автора испанский — описание голоса тоже испанское)'
    : lang === 'de'
    ? 'НА НЕМЕЦКОМ ЯЗЫКЕ (блог автора немецкий — описание голоса тоже немецкое)'
    : lang === 'ru'
    ? 'на русском'
    : 'НА ЯЗЫКЕ ОБРАЗЦОВ (описание голоса пишется на том же языке, на котором автор ведёт блог)'

  return `Проанализируй ${units.length} текстов одного автора и опиши его Tone of Voice так,
чтобы по этому описанию можно было воспроизвести его голос при генерации нового контента.

${samples}

СТРУКТУРА ОТВЕТА (в свободной форме, ${langLine}, прозой, с подзаголовками):

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

ЖЕЛЕЗНОЕ ПРАВИЛО ЦИТАТ: примеры слов, оборотов и фирменных приёмов выписывай ДОСЛОВНО на языке автора, в кавычках. НЕ переводи их — переведённая цитата теряет голос.

Пиши кратко и по делу. Без JSON и markdown-code-блоков — просто текст с подзаголовками. Заголовки разделов пиши на том же языке, что и всё описание.`
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'extract-tone')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  const denied = await requirePaidAccess(user.id)
  if (denied) return denied

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

  // Язык блога проекта: явная настройка → описание ToV на нём; нет настройки →
  // 'auto' (модель пишет описание на языке образцов). До миграции 038 колонки
  // может не быть — maybeSingle без падения, поведение как раньше.
  let tovLang: ContentLanguage | 'auto' = 'auto'
  try {
    const { data: proj } = await supabase
      .from('projects').select('*').eq('id', projectId).maybeSingle()
    tovLang = resolveContentLanguage(proj as { content_language?: string | null } | null) ?? 'auto'
  } catch { /* колонки/проекта нет — auto */ }

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

  // Извлечение — в after() (24.08, свип класса «мобильная вкладка убивает
  // долгий запрос», жалобы Кристины/Жени): SSE умирал вместе с экраном
  // телефона. Ответ 202 сразу; клиент поллит статус материала tone_of_voice
  // (processing → ready/error) — статус живёт в самом материале, поэтому
  // даже закрытая вкладка ничего не теряет.
  after(async () => {
    try {
      const aiStream = anthropic.messages.stream({
        model:      MODEL,
        max_tokens: 10000,
        system:     TOV_SYSTEM,
        messages:   [{ role: 'user', content: buildPrompt(clean, tovLang) }],
      })
      for await (const chunk of aiStream) {
        void chunk // стрим вычитывается ради устойчивости долгого вызова
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
        await captureException(new Error(`ToV собран, но не сохранился: ${saveErr.message}`), { where: 'extract-tone-of-voice save' })
        try {
          await upsertProjectMaterial(supabase, {
            project_id:        projectId,
            title:             TOV_TITLE,
            material_type:     'tone_of_voice',
            raw_content:       '❌ Tone of Voice собран, но не сохранился. Нажми «Из моих текстов» ещё раз.',
            processing_status: 'error',
          })
        } catch { /* swallow */ }
      }
    } catch (err) {
      console.error('[extract-tone-of-voice] error:', err instanceof Error ? err.message : err)
      // Сырец — в телеметрию; в материал — честный текст без хвостов провайдера
      await captureException(err, { where: 'extract-tone-of-voice' })
      try {
        await upsertProjectMaterial(supabase, {
          project_id:        projectId,
          title:             TOV_TITLE,
          material_type:     'tone_of_voice',
          raw_content:       `❌ Tone of Voice не извлёкся: генерация была перегружена. Нажми «Из моих текстов» ещё раз — если повторится, напиши нам.`,
          processing_status: 'error',
        })
      } catch { /* swallow */ }
    }
  })

  // 202 сразу: извлечение идёт в фоне, клиент поллит материал tone_of_voice.
  return NextResponse.json({ started: true }, { status: 202 })
}