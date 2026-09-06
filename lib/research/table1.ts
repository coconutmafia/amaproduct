// Ядро «Таблицы исследования» (table1): типы, промпт, канонизация вопросов и
// один прогон батча расшифровок через Claude. Вынесено из роута research-analyze
// 24.08, чтобы фоновый джоб (lib/jobs/runResearchTableJob.ts) использовал РОВНО
// ту же логику, что и синхронный шаг роута — промпт и формат не раздваиваются.
import type { SupabaseClient } from '@supabase/supabase-js'
import { anthropic, MODEL } from '@/lib/ai/client'
import { MASTER_RESEARCH_TITLE } from '@/lib/researchMaster'
import { toArray, toRecord, toStringList } from '@/lib/ai/toolInput'

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

export const TABLE1_SYSTEM = `Ты — аналитик аудиторного исследования.
Твоя задача — структурировать расшифровку интервью в чёткую таблицу.
Всегда возвращай ТОЛЬКО валидный JSON без markdown-обёрток, без пояснений.`

export function buildTable1Prompt(transcription: string, knownQuestions: string[] = []): string {
  // Блок канонизации: вопросы должны совпадать МЕЖДУ кастдевами проекта —
  // иначе сводная таблица (строка = участник, колонки = вопросы) рассыпается
  // на десятки колонок-вариаций с пустотами.
  const canonBlock = knownQuestions.length > 0 ? `

ЕДИНЫЙ СПИСОК ВОПРОСОВ ПРОЕКТА (уже использованы в прошлых кастдевах):
${knownQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

ПРАВИЛО: если вопрос интервью ПО СМЫСЛУ совпадает с одним из списка — используй ДОСЛОВНО эту формулировку (символ в символ), даже если в записи он прозвучал другими словами. Новую формулировку заводи только для вопроса, которого в списке действительно нет.` : ''

  return `Проанализируй расшифровку интервью с аудиторией. Верни ТОЛЬКО JSON.

РАСШИФРОВКА:
${transcription}

ЗАДАЧА: Определи всех участников (респондентов) и все вопросы интервью.
Для каждого участника и каждого вопроса заполни структуру.
Формулируй вопросы ОБОБЩЁННО и ПОВТОРЯЕМО (без деталей конкретного диалога): один и тот же вопрос в разных интервью обязан получить одинаковую формулировку.${canonBlock}

КТО РЕСПОНДЕНТ. Респондент — человек, который ОТВЕЧАЕТ на вопросы интервью.
В обычном кастдеве один-на-один респондент ровно ОДИН — даже если реплики в
расшифровке не размечены по ролям: раздели их по смыслу (кто спрашивает, а
кто рассказывает о себе). Интервьюер — тот, кто задаёт вопросы и ведёт
беседу, — НЕ респондент и в respondents не попадает (инцидент 29.08:
владелица проекта попала в таблицу как участник собственного кастдева).
Пустой respondents верни только если в записи вообще никто не отвечает на
вопросы (монолог, приветствие, обрывок).

ПУСТОЕ = ПУСТОЕ:
- В full_answer пиши только СОДЕРЖАНИЕ ответа участника. Запрещены
  мета-описания разговора: «участник отвечает на вопрос о…», «обсуждается
  вопрос о…», «речь идёт о…» — это не ответы. Нет содержательного ответа —
  НЕ включай этот вопрос в answers этого участника вовсе.
- В segment нет фактов — пустая строка "". Не пиши «данных о себе не
  сообщил» и подобные заполнители.

ЯЗЫК: расшифровка может быть на любом языке или смеси языков (вопросы на
одном, ответы на другом). Таблицу ВСЕГДА пиши по-русски: full_answer и
key_quotes иноязычных ответов переводи на русский точно и близко к оригиналу,
ничего не добавляя. Если одна и та же беседа встречается в нескольких файлах
(дубль записи) — это ОДИН участник, не два.

Блоки вопросов:
- point_a: текущая ситуация / что не устраивает / боли
- point_b: желаемый результат / идеальная ситуация
- barriers: барьеры / страхи / возражения / что мешало раньше
- criteria: критерии выбора специалиста/продукта
- other: всё остальное

ЖЕЛЕЗНОЕ ПРАВИЛО ПОРТРЕТА (segment) — только факты, которые участник НАЗВАЛ СЛОВАМИ, по ВСЕЙ расшифровке:
- НИЧЕГО не выводи из умолчаний. Не назвал семейное положение — НЕ пиши его: «живу с ребёнком» ≠ «мать-одиночка» (реальный инцидент: участница упомянула мужа дальше по интервью, а портрет записал её матерью-одиночкой по первому ответу). Муж/жена, упомянутые в ЛЮБОМ месте интервью, = состоит в браке.
- Числа пиши как прозвучали: «доход около 3» ≠ «3000 в месяц», если единицы и период не названы.
- Непонятные обрывки расшифровки («мониторщик») в портрет не тащи — пропусти.
- Сомневаешься в факте — НЕ включай его. Портрет из двух точных фактов лучше портрета с одной выдумкой.

JSON формат (строго, без markdown):
{
  "respondents": [
    {
      "id": "Участник 1",
      "name": "имя если упомянуто, иначе пусто",
      "segment": "демографический портрет ТОЛЬКО из фактов, названных участником (см. железное правило выше)",
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

export const NO_RESPONDENTS_MESSAGE = 'AI не нашёл в расшифровке участников интервью. Проверь, что это запись интервью.'

const qKey = (q: string) => q.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim()

/** Уникальные формулировки вопросов в порядке первого появления (пунктуация/регистр не различаются). */
export function uniqueQuestions(list: string[], limit = 60): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const q = String(raw ?? '').trim()
    const k = qKey(q)
    if (!q || !k || seen.has(k)) continue
    seen.add(k); out.push(q)
    if (out.length >= limit) break
  }
  return out
}

/** Вопросы, прозвучавшие в уже разобранных интервью — канон для следующих батчей. */
export function questionsOf(respondents: Respondent[]): string[] {
  return uniqueQuestions(respondents.flatMap(r => (r.answers ?? []).map(a => a.question)))
}

const BLOCKS = new Set(['point_a', 'point_b', 'barriers', 'criteria', 'other'])

// Модель временами отдаёт respondents / answers / key_quotes JSON-СТРОКОЙ
// вместо массива (замер 06.09 на батче Стаси: 2 прогона из 3, 19–23 тыс.
// знаков валидной таблицы). Раньше это читалось как «участников нет» и джоб
// уходил в ошибку — теперь любая форма приводится к InterviewTable.
export function normalizeTable(raw: unknown): InterviewTable {
  const root = toRecord(raw) ?? {}
  const respondents: Respondent[] = toArray(root.respondents).map((r, i) => {
    const o = toRecord(r) ?? {}
    const answers: RespondentAnswer[] = toArray(o.answers).map((a) => {
      const x = toRecord(a) ?? {}
      const block = String(x.block ?? 'other')
      return {
        question:       String(x.question ?? '').trim(),
        block:          (BLOCKS.has(block) ? block : 'other') as RespondentAnswer['block'],
        full_answer:    String(x.full_answer ?? '').trim(),
        key_quotes:     toStringList(x.key_quotes),
        emotional_tone: String(x.emotional_tone ?? '').trim(),
      }
    }).filter(a => a.question && a.full_answer)
    return {
      id:      String(o.id ?? '').trim() || `Участник ${i + 1}`,
      name:    String(o.name ?? '').trim(),
      segment: String(o.segment ?? '').trim(),
      answers,
    }
  }).filter(r => r.answers.length > 0)
  return { respondents }
}

// Канонизация: формулировки вопросов из мастер-таблицы проекта (файл Дарьи,
// 11 августа) — совпадающий по смыслу вопрос переиспользуется дословно.
export async function loadKnownQuestions(supabase: SupabaseClient, projectId: string): Promise<string[]> {
  try {
    const { data: master } = await supabase
      .from('project_materials')
      .select('raw_content')
      .eq('project_id', projectId)
      .eq('title', MASTER_RESEARCH_TITLE)
      .maybeSingle()
    if (master?.raw_content) {
      const found: string[] = []
      for (const m of String(master.raw_content).matchAll(/^\s*Вопрос:\s*(.+)$/gm)) found.push(m[1].trim())
      return uniqueQuestions(found)
    }
  } catch { /* мастера ещё нет — обычный режим */ }
  return []
}

const tableTool = {
  name: 'interview_table',
  description: 'Структурированная таблица аудиторного исследования',
  input_schema: {
    type: 'object' as const,
    properties: {
      respondents: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id:      { type: 'string' },
            name:    { type: 'string' },
            segment: { type: 'string' },
            answers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  question:       { type: 'string' },
                  block:          { type: 'string', description: 'point_a | point_b | barriers | criteria | other' },
                  full_answer:    { type: 'string' },
                  key_quotes:     { type: 'array', items: { type: 'string' } },
                  emotional_tone: { type: 'string' },
                },
                required: ['question', 'block', 'full_answer'],
              },
            },
          },
          required: ['id', 'name', 'answers'],
        },
      },
    },
    required: ['respondents'],
  },
}

export type Table1BatchResult =
  | { ok: true; table: InterviewTable }
  | { ok: false; error: string; retryable: boolean }

// Один батч расшифровок → таблица. Форс-тул + стрим с потолком 32k — защита
// от обрезанного JSON (25 июля). Ошибки — ЧЕЛОВЕЧЕСКИМ текстом (их читает
// клиент и джоб пишет их в job.error). Ответ модели нормализуется
// (normalizeTable) — строка вместо массива больше не роняет батч.
export async function runTable1Batch(transcription: string, knownQuestions: string[]): Promise<Table1BatchResult> {
  let finalMsg
  try {
    const stream = anthropic.messages.stream({
      model:       MODEL,
      max_tokens:  32000,
      system:      TABLE1_SYSTEM,
      tools:       [tableTool],
      tool_choice: { type: 'tool' as const, name: 'interview_table' },
      messages:    [{ role: 'user', content: buildTable1Prompt(transcription, knownQuestions) }],
    })
    finalMsg = await stream.finalMessage()
  } catch {
    return { ok: false, error: 'Генерация сейчас перегружена или временно недоступна. Подожди 1-2 минуты и нажми ещё раз — расшифровка не потеряется.', retryable: true }
  }
  if (finalMsg.stop_reason === 'max_tokens') {
    return { ok: false, error: 'Интервью слишком длинные для одной таблицы. Загрузи и обработай их по одному — таблицы можно объединить в материалах проекта.', retryable: false }
  }
  const toolBlock = finalMsg.content.find((b) => b.type === 'tool_use')
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    console.error('[table1] no tool_use. stop_reason=%s', finalMsg.stop_reason)
    return { ok: false, error: 'AI не смог структурировать данные. Попробуй ещё раз.', retryable: true }
  }
  // Пустой список участников — НЕ ошибка батча: решает вызывающий (в джобе
  // пустой батч пропускается, ошибка только если участников нет нигде;
  // синхронный роут отвечает NO_RESPONDENTS_MESSAGE).
  return { ok: true, table: normalizeTable(toolBlock.input) }
}
