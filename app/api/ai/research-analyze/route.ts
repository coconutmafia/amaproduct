import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/client'
import { NextResponse } from 'next/server'

export const maxDuration = 120

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

// ── Route ──────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    projectId:     string
    step:          'table1' | 'table2'
    transcription?: string
    table1?:       InterviewTable
  }

  const { projectId, step, transcription, table1 } = body

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
      max_tokens: 4096,
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

    // Save raw transcription to project_materials (for RAG)
    await supabase.from('project_materials').upsert({
      project_id:        projectId,
      title:             `Расшифровка интервью`,
      material_type:     'interview_transcription',
      raw_content:       transcription,
      processing_status: 'ready',
    }, { onConflict: 'project_id,material_type,title' })

    return NextResponse.json({ table1: data })
  }

  // ── Step 2: Table 1 → Meanings Map ─────────────────────────────────────────
  if (step === 'table2') {
    if (!table1) return NextResponse.json({ error: 'table1 required' }, { status: 400 })

    const response = await anthropic.messages.create({
      model:      MODEL,
      max_tokens: 4096,
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

  return NextResponse.json({ error: 'Invalid step' }, { status: 400 })
}
