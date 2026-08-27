import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rateLimit'
import { requirePaidAccess } from '@/lib/billing/access'
import { gateContentUnits, refundGenerations } from '@/lib/generations'
import { UNIT_COSTS } from '@/lib/generations-config'
import { fmtDateRu } from '@/lib/dates'
import { upsertProjectMaterial } from '@/lib/supabase/upsertMaterial'
import { embedMaterialChunks } from '@/lib/ai/embed'
import { captureException } from '@/lib/sentry'

// Честный текст, когда упал САМ вызов Claude (кредиты/перегруз/сеть) — «AI не
// смог структурировать» здесь ложь: он даже не начал. Утро 31 июля: клиентка
// несколько раз попала в такое окно (обе кассы пустые), увидела страшную
// ошибку и ушла. Полная причина — в error_events через captureException.
const AI_BUSY =
  'Генерация сейчас перегружена или временно недоступна. Подожди 1-2 минуты и нажми ещё раз — расшифровка не потеряется.'
import { anthropic, MODEL } from '@/lib/ai/client'
import { requireProjectAccess } from '@/lib/projects/access'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, after } from 'next/server'
import { MASTER_RESEARCH_TITLE } from '@/lib/researchMaster'
import { loadKnownQuestions, runTable1Batch } from '@/lib/research/table1'
import type { InterviewTable } from '@/lib/research/table1'

export const maxDuration = 300

// ── Types ─────────────────────────────────────────────────────────────────────
// Ядро table1 вынесено в lib/research/table1.ts (24.08) — общее для этого роута
// и фонового джоба runResearchTableJob. Типы реэкспортируются: клиенты
// импортируют их отсюда исторически.
export type { RespondentAnswer, Respondent, InterviewTable } from '@/lib/research/table1'

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

// TABLE1_SYSTEM/buildTable1Prompt живут в lib/research/table1.ts (общие с джобом)

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

// ── Карта смыслов «как в уроке» ──────────────────────────────────────────────
// Плоская строка таблицы урока: Категория | Общая формулировка | Формулировка
// клиента | Идея контента. Одна формулировка клиента = одна строка, у каждой
// СВОЯ идея контента (в уроке ровно так: пример «я толстая» → три формулировки
// → три идеи). Группировка = одинаковый general у нескольких строк.
export interface MeaningsRow {
  type: 'pain' | 'need' | 'trigger' | 'objection' | 'advantage'
  general: string
  client_words: string
  content_idea: string
}

// Метки и порядок — 1-в-1 со слайдов ВИДЕОУРОКА «Карта смыслов» (сверка по
// youtu.be/9HYmNJL94yE, слайды «СТОЛБЕЦ 1. КАТЕГОРИЯ» и «ЧТО РАЗМЕЩАЕМ?»):
// Боли → Хотелки, Потребности → Триггеры → Возражения → Ваши преимущества.
// Файл «Касдевы Ава.xlsx» отсортирован иначе самой клиенткой — канон слайд.
const MEANINGS_RU: Record<MeaningsRow['type'], string> = {
  pain:      'БОЛИ',
  need:      'ХОТЕЛКИ, ПОТРЕБНОСТИ',
  trigger:   'ТРИГГЕРЫ',
  objection: 'ВОЗРАЖЕНИЯ',
  advantage: 'ВАШИ ПРЕИМУЩЕСТВА',
}
const MEANINGS_TYPE_ORDER: MeaningsRow['type'][] = ['pain', 'need', 'trigger', 'objection', 'advantage']

const meaningsRowsTool = {
  name: 'meanings_rows',
  description: 'Строки таблицы «Карта смыслов» по методологии урока',
  input_schema: {
    type: 'object' as const,
    properties: {
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type:         { type: 'string', description: 'pain | need | trigger | objection | advantage' },
            general:      { type: 'string', description: 'Общая формулировка (сгруппированная боль/потребность/триггер/возражение/преимущество)' },
            client_words: { type: 'string', description: 'Дословная формулировка ОДНОГО клиента, его словами из интервью' },
            content_idea: { type: 'string', description: 'Идея контента именно для ЭТОЙ формулировки' },
          },
          required: ['type', 'general', 'client_words', 'content_idea'],
        },
      },
    },
    required: ['rows'],
  },
}

// Бюджет входа карты смыслов (17.08, кейс Кристины Маринич): жёсткий кап 9000
// на материал резал «Полные анализы кастдевов» по 30-50k так, что в промпт
// попадала только шапка-оглавление без единой цитаты — карта «не менялась»
// даже после успешной пересборки. Теперь кап динамический: до 24k на материал
// в пределах общего бюджета ~380k символов (~110k токенов; вместе с промптом и
// 32k выхода влезает в контекст с запасом), но не ниже прежних 9000.
const MEANINGS_PER_MATERIAL_CAP = 24000
const MEANINGS_TOTAL_BUDGET     = 380000

function buildMeaningsLessonPrompt(materials: { title: string; raw_content: string }[]): string {
  const cap = Math.max(
    PER_MATERIAL_CAP,
    Math.min(MEANINGS_PER_MATERIAL_CAP, Math.floor(MEANINGS_TOTAL_BUDGET / Math.max(1, materials.length))),
  )
  const combined = materials
    .map(m => {
      const content = m.raw_content.length > cap
        ? m.raw_content.slice(0, cap) + '\n…(текст обрезан)'
        : m.raw_content
      return `=== ${m.title} ===\n${content}`
    })
    .join('\n\n')

  return `Заполни «Карту смыслов» по данным кастдевов. Верни строки таблицы через инструмент meanings_rows.

МАТЕРИАЛЫ ИССЛЕДОВАНИЯ:
${combined}

КАК ЗАПОЛНЯТЬ (строго по уроку «Карта смыслов»):
Таблица из 4 столбцов: Категория | Общая формулировка | Формулировка клиента | Идея контента.

1. Категория (поле type):
   - pain (боли): ответы на «что тебя не устраивает, от чего хочешь избавиться» — точка А
   - need (хотелки, потребности): «с каким запросом пришёл», точка Б — «А как ты хочешь, чтобы было?». Этот вопрос звучит в КАЖДОМ интервью — потребности должны быть выписаны у каждого участника
   - trigger (триггеры): что повлияло на выбор — «Почему ты купил у другого человека?», почему покупают у вас; спусковой крючок для покупки (увидел результат, порекомендовали, событие в жизни)
   - objection (возражения): почему ещё не купил / не действует; «Что тебе важно, когда ты покупаешь?»; «дорого»; страхи. Самая мощная часть карты — вытащи все возражения из всех интервью
   - advantage (ваши преимущества): из кастдевов «Что тебе нравится во мне? Что ты знаешь обо мне?» — что говорят об эксперте и его продукте, за что ценят, почему выбрали бы именно его

2. Общая формулировка (general) — ГРУППИРОВКА: если несколько участников говорят об одном, даже разными словами, это ОДНА общая формулировка. Пример из урока: общая боль «я толстая» объединяет «чувствую себя неуверенно в теле и имею лишние килограммы», «поправилась после родов и не могу похудеть», «то теряю, то набираю вес». НЕ дроби близкие боли на отдельные общие формулировки.

3. Формулировка клиента (client_words) — ДОСЛОВНО, словами участника из интервью. Одна формулировка = одна строка (одна запись rows). Все формулировки всех участников по одной общей боли идут отдельными строками с тем же general.

4. Идея контента (content_idea) — на КАЖДУЮ формулировку СВОЯ идея: как отработать её в контенте (кейс, экспертный разбор, личная история, метод, преимущество продукта). Формат (сторис/пост/рилз) не указывай — только идею.

Пройди ВСЕ интервью, ничего не выдумывай: формулировки — только из текста материалов.`
}

// Модель может вернуть кривые типы/пустые поля — приводим к строгим строкам,
// пустые формулировки выбрасываем, порядок категорий — как в уроке.
function normalizeMeaningRows(raw: unknown[]): MeaningsRow[] {
  const VALID = new Set<MeaningsRow['type']>(['pain', 'need', 'trigger', 'objection', 'advantage'])
  const rows: MeaningsRow[] = []
  for (const r of raw) {
    const c = (r ?? {}) as Record<string, unknown>
    const rawType = String(c.type ?? '').toLowerCase().trim() as MeaningsRow['type']
    const client = String(c.client_words ?? '').trim()
    if (!client) continue
    rows.push({
      type:         VALID.has(rawType) ? rawType : 'pain',
      general:      String(c.general ?? '').trim() || 'Без названия',
      client_words: client,
      content_idea: String(c.content_idea ?? '').trim(),
    })
  }
  rows.sort((a, b) => MEANINGS_TYPE_ORDER.indexOf(a.type) - MEANINGS_TYPE_ORDER.indexOf(b.type))
  return rows
}

// Текст материала: читаемый глазами и парсится обратно в 4 колонки
// (lib/researchTables.ts meaningsMapToAoa). Группа = [КАТЕГОРИЯ] Общая
// формулировка, внутри — строки «— «формулировка» / Идея контента: …».
function meaningRowsToText(rows: MeaningsRow[]): string {
  // Группируем по (тип, общая формулировка) в порядке первого появления —
  // модель не обязана держать строки одной группы рядом.
  const groups = new Map<string, { head: string; lines: string[] }>()
  for (const r of rows) {
    const key = `${r.type}::${r.general}`
    let g = groups.get(key)
    if (!g) { g = { head: `[${MEANINGS_RU[r.type]}] ${r.general}`, lines: [] }; groups.set(key, g) }
    g.lines.push(`— «${r.client_words.replace(/[«»]/g, '')}»`)
    if (r.content_idea) g.lines.push(`  Идея контента: ${r.content_idea}`)
  }
  return [...groups.values()].map(g => [g.head, ...g.lines].join('\n')).join('\n\n')
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
    transcriptMaterialIds?: string[]
    transcription?: string
    table1?:       InterviewTable
    batchIndex?:   number
    categories?:   MeaningsCategory[]
  }

  const { projectId, step, transcription, table1, batchIndex, categories, transcriptMaterialIds } = body

  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  // meanings_status — дешёвый read для поллинга фоновой сборки карты (17.08):
  // клиент опрашивает его каждые ~5с, поэтому БЕЗ rateLimit (иначе поллинг сам
  // съедает лимит research-analyze) и без paid-гейта; членство в проекте
  // проверяется ниже как для всех шагов.
  if (step !== 'meanings_status') {
    const rl = await rateLimit(user.id, 'research-analyze')
    if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

    const denied = await requirePaidAccess(user.id)
    if (denied) return denied
  }

  const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { data: project } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', projectId)
    .single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // ── Статус карты смыслов (поллинг фоновой сборки) ───────────────────────────
  if (step === 'meanings_status') {
    const { data: mat } = await supabase
      .from('project_materials')
      .select('processing_status, raw_content, created_at')
      .eq('project_id', projectId)
      .eq('material_type', 'meanings_map')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!mat) return NextResponse.json({ exists: false })
    return NextResponse.json({
      exists:     true,
      status:     mat.processing_status,
      created_at: mat.created_at,
      // Текст материала отдаём только для error — там человеческое сообщение
      error: mat.processing_status === 'error' ? String(mat.raw_content ?? '').slice(0, 500) : undefined,
    })
  }

  // ── Step 1: Transcription → Table 1 ────────────────────────────────────────
  // Синхронный шаг сохранён для обратной совместимости (research-smoke, старые
  // вкладки); UI с 24.08 ходит через фоновый джоб /api/jobs/research-table —
  // оба пути зовут ОДНО ядро lib/research/table1.ts.
  if (step === 'table1') {
    if (!transcription) return NextResponse.json({ error: 'transcription required' }, { status: 400 })
    const knownQuestions = await loadKnownQuestions(supabase, projectId)
    const r = await runTable1Batch(transcription, knownQuestions)
    if (!r.ok) {
      await captureException(new Error(`table1: ${r.error}`), { where: 'research-analyze table1', projectId })
      return NextResponse.json({ error: r.error }, { status: r.retryable ? 503 : 400 })
    }
    return NextResponse.json({ table1: r.table })
  }

  // ── Step 2: Table 1 → Meanings Map ─────────────────────────────────────────
  if (step === 'table2') {
    if (!table1) return NextResponse.json({ error: 'table1 required' }, { status: 400 })

    // Та же защита, что в table1: форс-тул + стрим (см. комментарий выше).
    const meaningsTool = {
      name: 'meanings_map',
      description: 'Карта смыслов аудитории',
      input_schema: {
        type: 'object' as const,
        properties: {
          categories: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type:           { type: 'string', description: 'pain | need | trigger | objection' },
                category:       { type: 'string' },
                customer_words: { type: 'array', items: { type: 'string' } },
                deep_trigger:   { type: 'string' },
                objection:      { type: 'string' },
                content_idea:   { type: 'string' },
              },
              required: ['type', 'category'],
            },
          },
        },
        required: ['categories'],
      },
    }
    let t2final
    try {
      const t2stream = anthropic.messages.stream({
        model:       MODEL,
        max_tokens:  32000,
        system:      TABLE2_SYSTEM,
        tools:       [meaningsTool],
        tool_choice: { type: 'tool' as const, name: 'meanings_map' },
        messages:    [{ role: 'user', content: buildTable2Prompt(table1) }],
      })
      t2final = await t2stream.finalMessage()
    } catch (e) {
      await captureException(e, { where: 'research-analyze table2', projectId })
      return NextResponse.json({ error: AI_BUSY }, { status: 503 })
    }
    const t2block = t2final.content.find((b) => b.type === 'tool_use')
    if (!t2block || t2block.type !== 'tool_use') {
      console.error('[research-analyze table2] no tool_use. stop_reason=%s', t2final.stop_reason)
      return NextResponse.json({ error: 'AI не смог создать карту смыслов. Попробуй ещё раз.' }, { status: 500 })
    }
    const data = t2block.input as unknown as MeaningsMap
    if (!Array.isArray(data?.categories)) {
      return NextResponse.json({ error: 'AI не смог создать карту смыслов. Попробуй ещё раз.' }, { status: 500 })
    }

    // Save meanings map to project_materials — RAG will pick this up automatically
    // when generating content, so the AI will use audience language
    const meaningsText = data.categories
      .map(c => `[${c.type.toUpperCase()}] ${c.category}:\nФормулировки: ${c.customer_words.join(', ')}\nГлубинный триггер: ${c.deep_trigger}\nВозражение: ${c.objection}\nИдея контента: ${c.content_idea}`)
      .join('\n\n')

    await upsertProjectMaterial(supabase, {
      project_id:        projectId,
      title:             'Карта смыслов (исследование аудитории)',
      material_type:     'meanings_map',
      raw_content:       meaningsText,
      processing_status: 'ready',
    })

    return NextResponse.json({ table2: data })
  }

  // ── Step: Save transcript + table to materials ──────────────────────────────
  if (step === 'save') {
    if (!transcription) return NextResponse.json({ error: 'transcription required' }, { status: 400 })
    if (!table1) return NextResponse.json({ error: 'table1 required' }, { status: 400 })

    const dateLabel = fmtDateRu(Date.now(), { day: 'numeric', month: 'long' })

    // Build human-readable table text
    const tableText = table1.respondents.map(r => {
      const header = `Участник: ${r.name || r.id}${r.segment ? ` (${r.segment})` : ''}`
      const answers = r.answers.map(a =>
        `  Вопрос: ${a.question}\n  Ответ: ${a.full_answer}\n  Цитаты: ${a.key_quotes.join(' | ')}\n  Тон: ${a.emotional_tone}`
      ).join('\n\n')
      return `${header}\n\n${answers}`
    }).join('\n\n---\n\n')

    // Insert transcript + research table, capturing ids so we can embed the
    // FULL text into project_chunks. These materials run tens of thousands of
    // chars (a 60-min interview ≈ 100k+); the ALWAYS_INCLUDE raw layer keeps a
    // truncated baseline, and the embeddings make the whole thing retrievable
    // by relevance → nothing is lost.
    // Расшифровки уже сохранил transcribe-джоб (по материалу на файл) — если
    // их id пришли и реально принадлежат проекту (RLS-select), дубль не создаём.
    let transcriptSavedByJob = false
    if (Array.isArray(transcriptMaterialIds) && transcriptMaterialIds.length > 0) {
      const ids = transcriptMaterialIds.filter((x): x is string => typeof x === 'string').slice(0, 20)
      const { data: owned } = await supabase.from('project_materials')
        .select('id').in('id', ids).eq('project_id', projectId)
      transcriptSavedByJob = (owned?.length ?? 0) > 0
    }

    const { data: trRow } = transcriptSavedByJob
      ? { data: null }
      : await supabase.from('project_materials').insert({
          project_id:        projectId,
          title:             `Расшифровка интервью · ${dateLabel}`,
          material_type:     'interview_transcript',
          raw_content:       transcription,
          processing_status: 'ready',
        }).select('id').single()

    const { data: tblRow } = await supabase.from('project_materials').insert({
      project_id:        projectId,
      title:             `Таблица исследования · ${dateLabel}`,
      material_type:     'audience_research',
      raw_content:       tableText,
      processing_status: 'ready',
    }).select('id').single()

    // Эмбеддинг НЕ должен валить сохранение: материал ценнее индекса. Утро
    // 31 июля: OpenAI сидел без кредитов — упади embed тут, клиент увидел бы
    // «ничего не сохраняется» при живых материалах. RAG без чанков всё равно
    // работает (raw-слой ALWAYS_INCLUDE).
    try {
      if (trRow?.id) await embedMaterialChunks(trRow.id, projectId, transcription)
      if (tblRow?.id) await embedMaterialChunks(tblRow.id, projectId, tableText)
    } catch (e) {
      await captureException(e, { where: 'research-analyze save embed', projectId })
    }

    // ── Общая таблица кастдевов (просьба Августы 30 июля: «должна формироваться
    // одна единая, иначе замучаемся искать по отдельным таблицам»). Каждое
    // сохранение дописывает свой блок в мастер-материал; при первом запуске
    // мастер собирается ретроактивно из ВСЕХ уже существующих таблиц проекта.
    // Отдельные таблицы продолжаем сохранять как раньше (ничего не ломаем) —
    // мастер живёт рядом и всегда полон.
    const MASTER_TITLE = MASTER_RESEARCH_TITLE
    try {
      const block = `═══ Кастдев от ${dateLabel} ═══\n\n${tableText}`
      const { data: master } = await supabase
        .from('project_materials')
        .select('id, raw_content')
        .eq('project_id', projectId)
        .eq('title', MASTER_TITLE)
        .maybeSingle()
      if (master?.id) {
        await supabase.from('project_materials')
          .update({ raw_content: `${master.raw_content || ''}\n\n${block}`, processing_status: 'ready' })
          .eq('id', master.id)
      } else {
        const { data: olds } = await supabase
          .from('project_materials')
          .select('id, title, raw_content, created_at')
          .eq('project_id', projectId)
          .eq('material_type', 'audience_research')
          .order('created_at', { ascending: true })
        const prevBlocks = (olds ?? [])
          .filter((o) => o.id !== tblRow?.id && o.title?.startsWith('Таблица исследования'))
          .map((o) => `═══ ${String(o.title).replace('Таблица исследования · ', 'Кастдев от ')} ═══\n\n${o.raw_content ?? ''}`)
        await supabase.from('project_materials').insert({
          project_id:        projectId,
          title:             MASTER_TITLE,
          material_type:     'audience_research',
          raw_content:       [...prevBlocks, block].join('\n\n'),
          processing_status: 'ready',
        })
      }
    } catch (e) {
      // Мастер — производная от отдельных таблиц; его сбой не должен ронять
      // сохранение кастдева (данные не теряются, соберётся при следующем).
      console.error('[research-analyze] master table update failed:', e instanceof Error ? e.message : e)
    }

    return NextResponse.json({ ok: true })
  }

  // ── Step: Generate Meanings Map — SSE-streamed, ONE AI call ───────────────
  // Identical pattern to the warmup-plan route (which works on this host):
  // a single anthropic.messages.stream() with a heartbeat on every chunk +
  // a 10s keepalive. The connection never goes silent → mobile Safari can't
  // kill it ("грузилось, потом слетела" = silent >60s request was dropped).
  // One AI pass over all materials, like dropping every file into one chat.
  //
  // Формат — СТРОГО по уроку «Карта смыслов» (войс Августы 3 августа: «боли не
  // объединены, каждая боль отдельно… мы же прислали форму и урок»). Урок:
  // 4 столбца (Категория | Общая формулировка | Формулировка клиента | Идея
  // контента); категории: боли / потребности и хотелки / триггеры / возражения
  // / преимущества; формулировка каждого клиента = ОТДЕЛЬНАЯ строка, и на
  // каждую — СВОЯ идея контента. JSON — только форс-тулом (правило 25 июля).
  const MEANINGS_TITLE = 'Карта смыслов (исследование аудитории)'

  if (step === 'generate_meanings') {
    // Карта смыслов = UNIT_COSTS.meanings_map единиц. Самая тяжёлая операция
    // продукта: до 380k символов входа и 32k выхода (замер 25.08: до $1.39 за
    // пересборку), а кнопка «Обновить» нажимается повторно. Входит в подписку,
    // но расходует общий лимит — как и всё остальное.
    const gateM = await gateContentUnits(user.id, UNIT_COSTS.meanings_map)
    if (gateM.blocked) {
      const code = gateM.reason === 'not_entitled' ? 'payment_required' : 'limit_reached'
      return NextResponse.json(
        { error: code, code, monthlyUsed: gateM.monthlyUsed, monthlyLimit: gateM.monthlyLimit },
        { status: 402 },
      )
    }
    let materials: { title: string; raw_content: string }[] = []

    const research = await supabase
      .from('project_materials')
      .select('title, raw_content')
      .eq('project_id', projectId)
      .eq('material_type', 'audience_research')
      .neq('title', MASTER_RESEARCH_TITLE) // мастер = дубликат отдельных таблиц
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

    // Upsert a 'processing' placeholder IMMEDIATELY so the user can see
    // the request reached the server. If anything below blows up silently,
    // they at least see that something started — vs a hollow circle that
    // looks like the click never registered.
    try {
      await upsertProjectMaterial(supabase, {
        project_id:        projectId,
        title:             MEANINGS_TITLE,
        material_type:     'meanings_map',
        raw_content:       '⏳ Карта смыслов генерируется… Если эта надпись висит дольше 7 минут — что-то пошло не так, попробуй ещё раз.',
        processing_status: 'processing',
      })
    } catch { /* swallow */ }

    // Генерация — в after(): 17.08 Кристина Маринич жала «Обновить карту» с
    // телефона, SSE-запрос умирал вместе с вкладкой/блокировкой экрана, и
    // сборка обрывалась без следа (тот же класс, что вылечили у транскрибации
    // джобами). after() доживает после ответа независимо от клиента; клиент
    // поллит step=meanings_status до ready/error.
    // ЗАПИСЬ ИЗ ФОНОВОЙ ЧАСТИ — СЕРВИС-РОЛЬЮ, а не сессионным клиентом.
    // Прод 25.08: «ToV собран, но не сохранился: new row violates row-level
    // security policy» — внутри after() сессии уже нет, RLS режет запись, и
    // готовая работа клиента (минута ожидания + оплаченная генерация) пропадает.
    // Доступ к проекту проверен ВЫШЕ, в самом запросе, поэтому сервис-роль здесь
    // не расширяет права — она лишь переживает конец запроса.
    const bg = createAdminClient()

    after(async () => {
        try {
          // 32k выхода (как у table1): карта по уроку — строка на КАЖДУЮ
          // формулировку клиента, и на проекте с 20+ кастдевами (Katia,
          // 11 августа) 16k обрезались на середине tool-JSON → «карта не
          // собралась». 32k ≈ 350+ строк — запас на самые толстые проекты.
          const aiStream = anthropic.messages.stream({
            model:       MODEL,
            max_tokens:  32000,
            system:      TABLE2_SYSTEM,
            tools:       [meaningsRowsTool],
            tool_choice: { type: 'tool' as const, name: 'meanings_rows' },
            messages:    [{ role: 'user', content: buildMeaningsLessonPrompt(materials) }],
          })
          for await (const chunk of aiStream) {
            void chunk // стрим вычитывается ради устойчивости долгого вызова
          }
          const finalMsg = await aiStream.finalMessage()
          const toolBlock = finalMsg.content.find((b) => b.type === 'tool_use')
          const rawRows = toolBlock && toolBlock.type === 'tool_use'
            ? (toolBlock.input as { rows?: unknown[] }).rows ?? []
            : []
          const rows = normalizeMeaningRows(rawRows)

          if (rows.length === 0) {
            // Сырой stop_reason — в телеметрию (окно сбоев видно в
            // /admin/errors), клиенту — человеческий текст без техдеталей
            // (скрин 11 августа: «stop_reason=max_tokens» на экране клиента).
            console.error('[generate_meanings] no rows. stop_reason=%s blocks=%s',
              finalMsg.stop_reason, finalMsg.content.map(b => b.type).join(','))
            await captureException(
              new Error(`generate_meanings: пустая карта, stop_reason=${finalMsg.stop_reason}`),
              { where: 'generate_meanings no-rows', projectId, materials: materials.length },
            )
            try {
              await upsertProjectMaterial(bg, {
                project_id:        projectId,
                title:             MEANINGS_TITLE,
                material_type:     'meanings_map',
                raw_content:       '❌ Карта не собралась с первого захода. Нажми «Обновить карту из исследования» ещё раз — данные кастдевов не потерялись. Если повторится, напиши нам.',
                processing_status: 'error',
              })
            } catch { /* swallow */ }
            // Карта не собралась — работа не состоялась, единицы вернуть.
            await refundGenerations(user.id, UNIT_COSTS.meanings_map).catch(() => {})
            return
          }

          const meaningsText = meaningRowsToText(rows)

          const { error: saveErr } = await upsertProjectMaterial(bg, {
            project_id:        projectId,
            title:             MEANINGS_TITLE,
            material_type:     'meanings_map',
            raw_content:       meaningsText,
            processing_status: 'ready',
          })

          if (saveErr) {
            console.error('[generate_meanings] save error:', saveErr)
            await captureException(
              new Error(`generate_meanings: карта собрана, но не сохранилась: ${saveErr.message}`),
              { where: 'generate_meanings save', projectId },
            )
            try {
              await upsertProjectMaterial(bg, {
                project_id:        projectId,
                title:             MEANINGS_TITLE,
                material_type:     'meanings_map',
                raw_content:       '❌ Карта собралась, но не сохранилась. Нажми «Обновить карту из исследования» ещё раз.',
                processing_status: 'error',
              })
            } catch { /* swallow */ }
            await refundGenerations(user.id, UNIT_COSTS.meanings_map).catch(() => {})
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'AI недоступен'
          console.error('[generate_meanings] error:', msg)
          await captureException(err, { where: 'generate_meanings after()', projectId })
          // Persist the error too, so it stays visible in materials. Текст —
          // человеческий, без сырого msg/стека (их читает клиент в материале).
          try {
            await upsertProjectMaterial(bg, {
              project_id:        projectId,
              title:             MEANINGS_TITLE,
              material_type:     'meanings_map',
              raw_content:       '❌ Карта смыслов не собралась: генерация была перегружена. Нажми «Обновить карту из исследования» ещё раз — данные кастдевов не потерялись.',
              processing_status: 'error',
            })
          } catch { /* swallow */ }
          await refundGenerations(user.id, UNIT_COSTS.meanings_map).catch(() => {})
        }
    })

    // 202 сразу: сборка идёт в фоне, клиент поллит step=meanings_status.
    return NextResponse.json({ started: true }, { status: 202 })
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
      .neq('title', MASTER_RESEARCH_TITLE) // мастер = дубликат отдельных таблиц
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
      max_tokens: 12000,
      system:     TABLE2_SYSTEM,
      messages:   [{ role: 'user', content: buildMeaningsFromMaterialsPrompt(batch) }],
    })
    // find, не content[0]: у opus-5 первым блоком идёт thinking
    const t2b = resp.content.find(b => b.type === 'text')
    const raw = t2b && t2b.type === 'text' ? t2b.text : ''
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
        max_tokens: 12000,
        system:     TABLE2_SYSTEM,
        messages:   [{ role: 'user', content: buildMergeMeaningsPrompt(partial) }],
      })
      const mtb = mergeResp.content.find(b => b.type === 'text')
      const mergedRaw = mtb && mtb.type === 'text' ? mtb.text : ''
      const merged    = parseMap(mergedRaw)
      if (merged.length > 0) data = { categories: merged }
    }

    const meaningsText = data.categories
      .map(c => `[${c.type.toUpperCase()}] ${c.category}:\nФормулировки: ${c.customer_words.join(', ')}\nГлубинный триггер: ${c.deep_trigger}\nВозражение: ${c.objection}\nИдея контента: ${c.content_idea}`)
      .join('\n\n')

    await upsertProjectMaterial(supabase, {
      project_id:        projectId,
      title:             'Карта смыслов (исследование аудитории)',
      material_type:     'meanings_map',
      raw_content:       meaningsText,
      processing_status: 'ready',
    })

    return NextResponse.json({ table2: data })
  }

  return NextResponse.json({ error: 'Invalid step' }, { status: 400 })
}
