import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/client'
import { NextResponse } from 'next/server'

export const maxDuration = 300

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RespondentAnswer {
  question:       string
  block:          'point_a' | 'point_b' | 'barriers' | 'criteria' | 'other'
  full_answer:    string
  key_quotes:     string[]
  emotional_tone: string
}

export interface Respondent {
  id:       string
  name:     string
  segment:  string
  answers:  RespondentAnswer[]
}

export interface InterviewTable {
  respondents: Respondent[]
}

export interface MeaningsCategory {
  type:          'pain' | 'need' | 'trigger' | 'objection'
  category:      string
  customer_words: string[]
  deep_trigger:  string
  objection:     string
  content_idea:  string
}

export interface MeaningsMap {
  categories: MeaningsCategory[]
}

// ── Prompts ───────────────────────────────────────────────────────────────────

const TABLE1_SYSTEM = `Ты — аналитик аудиторного исследования.
Твоя задача — структурировать расшифровку интервью в чёткую таблицу.
Всегда возвращай ТОЛЬКО валидный JSON без markdown-обёрток, без пояснений.`

function buildTable1Prompt(transcription: string): string {
  return `Проанализируй расшифровку интервью с аудиторией. Верни ТОЛЬКО JSON.

РАСШИФРОВКА:
${transcription}

ЗАДАЧА: Определи всех участников (респондентов) и все вопросы интервью.
Для каждого участника и каждого вопроса заполни структуру.

Блоки вопросов:
- point_a: текущая ситуация / что не устраивает / боли
- point_b: желаемый результат / идеальная ситуация
- barriers: барьеры / страхи / возражения / что мешало раньше
- criteria: критерии выбора специалиста/продукта
- other: всё остальное

JSON формат (строго, без markdown):
{
  "respondents": [
    {
      "id": "Участник 1",
      "name": "имя если упомянуто, иначе пусто",
      "segment": "демографический портрет если понятен из контекста",
      "answers": [
        {
          "question": "краткая суть вопроса (10-15 слов)",
          "block": "point_a",
          "full_answer": "полный ответ участника дословно",
          "key_quotes": ["яркая фраза 1", "яркая фраза 2"],
          "emotional_tone": "боль/надежда/раздражение/бессилие/страх/желание/нейтрально"
        }
      ]
    }
  ]
}`
}

const TABLE2_SYSTEM = `Ты — стратег по контенту и маркетингу.
Твоя задача — из данных исследования аудитории собрать карту смыслов.
Всегда возвращай ТОЛЬКО валидный JSON без markdown-обёрток, без пояснений.`

function buildTable2Prompt(table1: InterviewTable): string {
  // Flatten all quotes for analysis
  const allAnswers = table1.respondents.flatMap(r =>
    r.answers.map(a => ({
      segment:  r.segment || r.id,
      block:    a.block,
      answer:   a.full_answer,
      quotes:   a.key_quotes,
      tone:     a.emotional_tone,
    }))
  )

  return `Из результатов исследования аудитории создай карту смыслов. Верни ТОЛЬКО JSON.

ДАННЫЕ ИССЛЕДОВАНИЯ:
${JSON.stringify(allAnswers, null, 2)}

ЗАДАЧА:
1. Найди повторяющиеся боли, потребности, триггеры и возражения
2. Сгруппируй похожие (например: "толстая жопа" + "лишних 5 кг" + "торчит живот" → категория "Лишний вес")
3. Сохрани ВСЕ дословные формулировки клиентов в customer_words — они будут использоваться в контенте
4. Выяви глубинный триггер за болью (психологическая причина)
5. Придумай идею, как подать продукт через эту боль

Типы категорий:
- pain: что болит прямо сейчас
- need: чего хочется достичь
- trigger: что запустило поиск решения
- objection: почему ещё не купили/не действуют

JSON формат (строго):
{
  "categories": [
    {
      "type": "pain",
      "category": "Общее название (например: Лишний вес / Эстетический дискомфорт)",
      "customer_words": ["толстая жопа", "лишних 5 кг", "живот висит", "не влезаю в джинсы"],
      "deep_trigger": "глубинная психологическая причина (страх, желание признания и т.д.)",
      "objection": "главное возражение — почему не действуют прямо сейчас",
      "content_idea": "идея: как подать продукт/оффер через эту боль в контенте"
    }
  ]
}`
}

// Cap per-material content. Research tables are condensed already; this keeps
// the single combined prompt small → faster generation. We only need enough
// signal to pull pains/needs/quotes, not every word of every transcript.
const PER_MATERIAL_CAP = 9000

function buildMeaningsFromMaterialsPrompt(materials: { title: string; raw_content: string }[]): string {
  const combined = materials
    .map(m => {
      const content = m.raw_content.length > PER_MATERIAL_CAP
        ? m.raw_content.slice(0, PER_MATERIAL_CAP) + '\n…(текст обрезан)'
        : m.raw_content
      return `=== ${m.title} ===\n${content}`
    })
    .join('\n\n')

  return `Из результатов исследования аудитории создай карту смыслов. Верни ТОЛЬКО JSON.

МАТЕРИАЛЫ ИССЛЕДОВАНИЯ:
${combined}

ЗАДАЧА:
1. Найди повторяющиеся боли, потребности, триггеры и возражения из всех материалов
2. Сгруппируй похожие (например: "толстая жопа" + "лишних 5 кг" + "торчит живот" → категория "Лишний вес")
3. Сохрани ВСЕ дословные формулировки клиентов в customer_words — они будут использоваться в контенте
4. Выяви глубинный триггер за болью (психологическая причина)
5. Придумай идею, как подать продукт через эту боль

Типы категорий (поле type — ТОЛЬКО одно из этих значений строкой):
- pain: что болит прямо сейчас
- need: чего хочется достичь
- trigger: что запустило поиск решения
- objection: почему ещё не купили/не действуют

ВАЖНО про формат:
- type, category, deep_trigger, objection, content_idea — простые строки.
- customer_words — ОБЯЗАТЕЛЬНО МАССИВ строк (["фраза 1", "фраза 2"]). НИКОГДА не одной склеенной строкой.

JSON формат (строго):
{
  "categories": [
    {
      "type": "pain",
      "category": "Общее название (например: Лишний вес / Эстетический дискомфорт)",
      "customer_words": ["толстая жопа", "лишних 5 кг", "живот висит", "не влезаю в джинсы"],
      "deep_trigger": "глубинная психологическая причина (страх, желание признания и т.д.)",
      "objection": "главное возражение — почему не действуют прямо сейчас",
      "content_idea": "идея: как подать продукт/оффер через эту боль в контенте"
    }
  ]
}`
}

// Normalize AI output — the model can return wrong types (customer_words
// as a string, unknown type values, etc.). Coerce everything to the right
// shape so downstream .join() / .toUpperCase() can't crash.
function normalizeCategories(raw: unknown[]): MeaningsCategory[] {
  const VALID = new Set(['pain', 'need', 'trigger', 'objection'])
  return raw.map((r) => {
    const c = (r ?? {}) as Record<string, unknown>
    const cw = c.customer_words
    let words: string[] = []
    if (Array.isArray(cw)) {
      words = cw.map(v => String(v ?? '').trim()).filter(s => s.length > 0)
    } else if (typeof cw === 'string') {
      // Split a string into phrases by line breaks, pipes, or sentence ends
      words = cw.split(/\s*[\n|]+|(?<=[.!?])\s+(?=[А-ЯA-Z«"])/)
                .map(s => s.trim())
                .filter(s => s.length > 3)
    }
    const rawType = String(c.type ?? '').toLowerCase().trim()
    return {
      type:          (VALID.has(rawType) ? rawType : 'pain') as MeaningsCategory['type'],
      category:      String(c.category ?? '').trim() || 'Без названия',
      customer_words: words,
      deep_trigger:  String(c.deep_trigger ?? '').trim(),
      objection:     String(c.objection ?? '').trim(),
      content_idea:  String(c.content_idea ?? '').trim(),
    }
  })
}

// Stage 2 of map-reduce: merge partial maps from each batch into one clean map.
function buildMergeMeaningsPrompt(categories: MeaningsCategory[]): string {
  return `Объедини частичные карты смыслов из разных групп интервью в одну чистую карту. Верни ТОЛЬКО JSON.

ЧАСТИЧНЫЕ КАТЕГОРИИ:
${JSON.stringify(categories, null, 2)}

ЗАДАЧА:
1. Объедини похожие категории в одну (например две «Лишний вес» → одна)
2. При объединении СОХРАНИ все customer_words из всех источников (это главное — они идут в контент)
3. Убери только точные дубликаты формулировок
4. Сохрани все типы: pain, need, trigger, objection

JSON формат (строго, без markdown):
{
  "categories": [
    {
      "type": "pain",
      "category": "Общее название",
      "customer_words": ["формулировка 1", "формулировка 2"],
      "deep_trigger": "глубинная психологическая причина",
      "objection": "главное возражение",
      "content_idea": "идея подачи через эту боль в контенте"
    }
  ]
}`
}

// ── Route ──────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    projectId:     string
    step:          'table1' | 'table2' | 'save' | 'generate_meanings' | 'meanings_status' | 'meanings_batch' | 'meanings_merge'
    transcription?: string
    table1?:       InterviewTable
    batchIndex?:   number
    categories?:   MeaningsCategory[]
  }

  const { projectId, step, transcription, table1, batchIndex, categories } = body

  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  // Verify project ownership
  const { data: project } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', projectId)
    .eq('owner_id', user.id)
    .single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // ── Step 1: Transcription → Table 1 ────────────────────────────────────────
  if (step === 'table1') {
    if (!transcription) return NextResponse.json({ error: 'transcription required' }, { status: 400 })

    const response = await anthropic.messages.create({
      model:      MODEL,
      max_tokens: 8000,
      system:     TABLE1_SYSTEM,
      messages:   [{ role: 'user', content: buildTable1Prompt(transcription) }],
    })

    const raw = response.content[0].type === 'text' ? response.content[0].text : ''

    let data: InterviewTable
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON found')
      data = JSON.parse(jsonMatch[0]) as InterviewTable
    } catch {
      return NextResponse.json({ error: 'AI не смог структурировать данные. Попробуй ещё раз.' }, { status: 500 })
    }

    return NextResponse.json({ table1: data })
  }

  // ── Step 2: Table 1 → Meanings Map ─────────────────────────────────────────
  if (step === 'table2') {
    if (!table1) return NextResponse.json({ error: 'table1 required' }, { status: 400 })

    const response = await anthropic.messages.create({
      model:      MODEL,
      max_tokens: 8000,
      system:     TABLE2_SYSTEM,
      messages:   [{ role: 'user', content: buildTable2Prompt(table1) }],
    })

    const raw = response.content[0].type === 'text' ? response.content[0].text : ''

    let data: MeaningsMap
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON found')
      data = JSON.parse(jsonMatch[0]) as MeaningsMap
    } catch {
      return NextResponse.json({ error: 'AI не смог создать карту смыслов. Попробуй ещё раз.' }, { status: 500 })
    }

    // Save meanings map to project_materials — RAG will pick this up automatically
    // when generating content, so the AI will use audience language
    const meaningsText = data.categories
      .map(c => `[${c.type.toUpperCase()}] ${c.category}:\nФормулировки: ${c.customer_words.join(', ')}\nГлубинный триггер: ${c.deep_trigger}\nВозражение: ${c.objection}\nИдея контента: ${c.content_idea}`)
      .join('\n\n')

    await supabase.from('project_materials').upsert({
      project_id:        projectId,
      title:             'Карта смыслов (исследование аудитории)',
      material_type:     'meanings_map',
      raw_content:       meaningsText,
      processing_status: 'ready',
    }, { onConflict: 'project_id,material_type,title' })

    return NextResponse.json({ table2: data })
  }

  // ── Step: Save transcript + table to materials ──────────────────────────────
  if (step === 'save') {
    if (!transcription) return NextResponse.json({ error: 'transcription required' }, { status: 400 })
    if (!table1) return NextResponse.json({ error: 'table1 required' }, { status: 400 })

    const dateLabel = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })

    // Build human-readable table text
    const tableText = table1.respondents.map(r => {
      const header = `Участник: ${r.name || r.id}${r.segment ? ` (${r.segment})` : ''}`
      const answers = r.answers.map(a =>
        `  Вопрос: ${a.question}\n  Ответ: ${a.full_answer}\n  Цитаты: ${a.key_quotes.join(' | ')}\n  Тон: ${a.emotional_tone}`
      ).join('\n\n')
      return `${header}\n\n${answers}`
    }).join('\n\n---\n\n')

    // Insert transcript
    await supabase.from('project_materials').insert({
      project_id:        projectId,
      title:             `Расшифровка интервью · ${dateLabel}`,
      material_type:     'interview_transcript',
      raw_content:       transcription,
      processing_status: 'ready',
    })

    // Insert research table
    await supabase.from('project_materials').insert({
      project_id:        projectId,
      title:             `Таблица исследования · ${dateLabel}`,
      material_type:     'audience_research',
      raw_content:       tableText,
      processing_status: 'ready',
    })

    return NextResponse.json({ ok: true })
  }

  // ── Step: Generate Meanings Map — SSE-streamed, ONE AI call ───────────────
  // Identical pattern to the warmup-plan route (which works on this host):
  // a single anthropic.messages.stream() with a heartbeat on every chunk +
  // a 10s keepalive. The connection never goes silent → mobile Safari can't
  // kill it ("грузилось, потом слетела" = silent >60s request was dropped).
  // One AI pass over all materials, like dropping every file into one chat.
  const MEANINGS_TITLE = 'Карта смыслов (исследование аудитории)'

  if (step === 'generate_meanings') {
    let materials: { title: string; raw_content: string }[] = []

    const research = await supabase
      .from('project_materials')
      .select('title, raw_content')
      .eq('project_id', projectId)
      .eq('material_type', 'audience_research')
    materials = (research.data ?? []) as typeof materials

    if (materials.length === 0) {
      const transcripts = await supabase
        .from('project_materials')
        .select('title, raw_content')
        .eq('project_id', projectId)
        .eq('material_type', 'interview_transcript')
      materials = (transcripts.data ?? []) as typeof materials
    }

    if (materials.length === 0) {
      return NextResponse.json(
        { error: 'Нет данных исследования аудитории. Сначала добавь хотя бы одно интервью.' },
        { status: 400 }
      )
    }

    const parseMap = (txt: string): MeaningsCategory[] => {
      if (!txt) return []
      // Strip markdown fences, then try whole-string parse, then brace-match
      const cleaned = txt.replace(/```json/gi, '').replace(/```/g, '').trim()
      const tryParse = (s: string): MeaningsCategory[] => {
        try {
          const o = JSON.parse(s) as MeaningsMap
          return Array.isArray(o.categories) ? o.categories : []
        } catch { return [] }
      }
      let cats = tryParse(cleaned)
      if (cats.length === 0) {
        const m = cleaned.match(/\{[\s\S]*\}/)
        if (m) cats = tryParse(m[0])
      }
      // Last resort: extract just the categories array if the outer JSON
      // is truncated/malformed
      if (cats.length === 0) {
        const a = cleaned.match(/"categories"\s*:\s*(\[[\s\S]*\])/)
        if (a) { try { cats = JSON.parse(a[1]) as MeaningsCategory[] } catch { /* give up */ } }
      }
      return cats
    }

    // Upsert a 'processing' placeholder IMMEDIATELY so the user can see
    // the request reached the server. If anything below blows up silently,
    // they at least see that something started — vs a hollow circle that
    // looks like the click never registered.
    try {
      await supabase.from('project_materials').upsert({
        project_id:        projectId,
        title:             MEANINGS_TITLE,
        material_type:     'meanings_map',
        raw_content:       '⏳ Карта смыслов генерируется… Если эта надпись висит дольше 5 минут — что-то пошло не так, попробуй ещё раз.',
        processing_status: 'processing',
      }, { onConflict: 'project_id,material_type,title' })
    } catch { /* swallow */ }

    const encoder = new TextEncoder()
    const stream  = new ReadableStream({
      async start(controller) {
        let closed = false
        const push = (s: string) => { if (!closed) { try { controller.enqueue(encoder.encode(s)) } catch { closed = true } } }
        const send = (d: Record<string, unknown>) => push(`data: ${JSON.stringify(d)}\n\n`)

        // Never let the connection go silent: immediate first byte, then a
        // ping every 10s regardless of AI latency / DB write.
        push(': open\n\n')
        const ping = setInterval(() => push(': ping\n\n'), 10000)

        try {
          send({ type: 'status', message: 'Анализирую все интервью...' })

          const aiStream = anthropic.messages.stream({
            model:      MODEL,
            max_tokens: 16000,
            system:     TABLE2_SYSTEM,
            messages:   [{ role: 'user', content: buildMeaningsFromMaterialsPrompt(materials) }],
          })
          for await (const chunk of aiStream) {
            if (chunk.type === 'content_block_delta') send({ type: 'progress' })
          }
          const finalMsg = await aiStream.finalMessage()
          // Concatenate ALL text blocks — newer Claude models may emit a
          // thinking/other block before the text answer, so content[0]
          // isn't reliably the text.
          const raw = finalMsg.content
            .map(b => (b.type === 'text' ? b.text : ''))
            .join('\n')
          const cats = normalizeCategories(parseMap(raw))

          if (cats.length === 0) {
            const blockTypes = finalMsg.content.map(b => b.type).join(',') || 'НЕТ БЛОКОВ'
            console.error('[generate_meanings] parse failed. stop_reason=%s blocks=%s raw[0..600]=%s',
              finalMsg.stop_reason, blockTypes, raw.slice(0, 600))
            // Persist the diagnostic as the meanings_map material with error
            // status. The user sees it in the materials list and can open /
            // download it — toasts disappear, this stays until we fix it.
            const diagnostic = [
              `❌ Не удалось разобрать ответ AI`,
              ``,
              `Причина остановки модели: ${finalMsg.stop_reason}`,
              `Типы блоков в ответе: [${blockTypes}]`,
              `Длина текстового ответа: ${raw.length} символов`,
              ``,
              `─── Полный ответ AI (первые 4000 символов) ───`,
              raw.slice(0, 4000) || '(пусто)',
            ].join('\n')
            try {
              await supabase.from('project_materials').upsert({
                project_id:        projectId,
                title:             MEANINGS_TITLE,
                material_type:     'meanings_map',
                raw_content:       diagnostic,
                processing_status: 'error',
              }, { onConflict: 'project_id,material_type,title' })
            } catch { /* swallow */ }
            send({
              type: 'error',
              message: `Не удалось разобрать ответ AI. Открой «Карта смыслов блога» в материалах и скачай — там полный текст ответа AI для диагностики.`,
            })
            return
          }

          const meaningsText = cats
            .map(c => `[${c.type.toUpperCase()}] ${c.category}:\nФормулировки: ${c.customer_words.join(', ')}\nГлубинный триггер: ${c.deep_trigger}\nВозражение: ${c.objection}\nИдея контента: ${c.content_idea}`)
            .join('\n\n')

          await supabase.from('project_materials').upsert({
            project_id:        projectId,
            title:             MEANINGS_TITLE,
            material_type:     'meanings_map',
            raw_content:       meaningsText,
            processing_status: 'ready',
          }, { onConflict: 'project_id,material_type,title' })

          send({ type: 'done' })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'AI недоступен'
          console.error('[generate_meanings] stream error:', msg)
          // Persist the error too, so it stays visible in materials
          try {
            await supabase.from('project_materials').upsert({
              project_id:        projectId,
              title:             MEANINGS_TITLE,
              material_type:     'meanings_map',
              raw_content:       `❌ Ошибка генерации карты смыслов\n\n${msg}\n\n(Стек: ${err instanceof Error && err.stack ? err.stack.slice(0, 1500) : 'нет'})`,
              processing_status: 'error',
            }, { onConflict: 'project_id,material_type,title' })
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

  // ── Client-orchestrated map-reduce (avoids one multi-minute request that
  //    iOS Safari / Vercel kills). Client loops batches, then calls merge. ──
  const MEANINGS_BATCH = 3

  const loadResearchMaterials = async () => {
    let mats: { title: string; raw_content: string }[] = []
    const research = await supabase
      .from('project_materials')
      .select('title, raw_content')
      .eq('project_id', projectId)
      .eq('material_type', 'audience_research')
    mats = (research.data ?? []) as typeof mats
    if (mats.length === 0) {
      const transcripts = await supabase
        .from('project_materials')
        .select('title, raw_content')
        .eq('project_id', projectId)
        .eq('material_type', 'interview_transcript')
      mats = (transcripts.data ?? []) as typeof mats
    }
    return mats
  }

  const parseMap = (txt: string): MeaningsCategory[] => {
    try {
      const m = txt.match(/\{[\s\S]*\}/)
      if (!m) return []
      return (JSON.parse(m[0]) as MeaningsMap).categories ?? []
    } catch { return [] }
  }

  // Step: process ONE batch of materials → partial categories
  if (step === 'meanings_batch') {
    const materials = await loadResearchMaterials()
    if (materials.length === 0) {
      return NextResponse.json(
        { error: 'Нет данных исследования аудитории. Сначала добавь хотя бы одно интервью.' },
        { status: 400 }
      )
    }
    const totalBatches = Math.ceil(materials.length / MEANINGS_BATCH)
    const bi    = batchIndex ?? 0
    const batch = materials.slice(bi * MEANINGS_BATCH, bi * MEANINGS_BATCH + MEANINGS_BATCH)

    const resp = await anthropic.messages.create({
      model:      MODEL,
      max_tokens: 8000,
      system:     TABLE2_SYSTEM,
      messages:   [{ role: 'user', content: buildMeaningsFromMaterialsPrompt(batch) }],
    })
    const raw = resp.content[0].type === 'text' ? resp.content[0].text : ''
    return NextResponse.json({ categories: parseMap(raw), totalBatches })
  }

  // Step: merge all partial categories → final map + save
  if (step === 'meanings_merge') {
    const partial = categories ?? []
    if (partial.length === 0) {
      return NextResponse.json({ error: 'AI не смог создать карту смыслов. Попробуй ещё раз.' }, { status: 500 })
    }

    let data: MeaningsMap = { categories: partial }
    if (partial.length > 8) {
      const mergeResp = await anthropic.messages.create({
        model:      MODEL,
        max_tokens: 8000,
        system:     TABLE2_SYSTEM,
        messages:   [{ role: 'user', content: buildMergeMeaningsPrompt(partial) }],
      })
      const mergedRaw = mergeResp.content[0].type === 'text' ? mergeResp.content[0].text : ''
      const merged    = parseMap(mergedRaw)
      if (merged.length > 0) data = { categories: merged }
    }

    const meaningsText = data.categories
      .map(c => `[${c.type.toUpperCase()}] ${c.category}:\nФормулировки: ${c.customer_words.join(', ')}\nГлубинный триггер: ${c.deep_trigger}\nВозражение: ${c.objection}\nИдея контента: ${c.content_idea}`)
      .join('\n\n')

    await supabase.from('project_materials').upsert({
      project_id:        projectId,
      title:             'Карта смыслов (исследование аудитории)',
      material_type:     'meanings_map',
      raw_content:       meaningsText,
      processing_status: 'ready',
    }, { onConflict: 'project_id,material_type,title' })

    return NextResponse.json({ table2: data })
  }

  return NextResponse.json({ error: 'Invalid step' }, { status: 400 })
}
