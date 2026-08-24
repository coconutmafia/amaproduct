// Ядро «Таблицы исследования» (table1): типы, промпт, канонизация вопросов и
// один прогон батча расшифровок через Claude. Вынесено из роута research-analyze
// 24.08, чтобы фоновый джоб (lib/jobs/runResearchTableJob.ts) использовал РОВНО
// ту же логику, что и синхронный шаг роута — промпт и формат не раздваиваются.
import type { SupabaseClient } from '@supabase/supabase-js'
import { anthropic, MODEL } from '@/lib/ai/client'
import { MASTER_RESEARCH_TITLE } from '@/lib/researchMaster'

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

// Канонизация: формулировки вопросов из мастер-таблицы проекта (файл Дарьи,
// 11 августа) — совпадающий по смыслу вопрос переиспользуется дословно.
export async function loadKnownQuestions(supabase: SupabaseClient, projectId: string): Promise<string[]> {
  let knownQuestions: string[] = []
  try {
    const { data: master } = await supabase
      .from('project_materials')
      .select('raw_content')
      .eq('project_id', projectId)
      .eq('title', MASTER_RESEARCH_TITLE)
      .maybeSingle()
    if (master?.raw_content) {
      const seen = new Set<string>()
      for (const m of String(master.raw_content).matchAll(/^\s*Вопрос:\s*(.+)$/gm)) {
        const q = m[1].trim()
        const k = q.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ')
        if (q && !seen.has(k)) { seen.add(k); knownQuestions.push(q) }
      }
      knownQuestions = knownQuestions.slice(0, 60)
    }
  } catch { /* мастера ещё нет — обычный режим */ }
  return knownQuestions
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
// клиент и джоб пишет их в job.error).
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
  const data = toolBlock.input as unknown as InterviewTable
  if (!Array.isArray(data?.respondents) || data.respondents.length === 0) {
    return { ok: false, error: 'AI не нашёл в расшифровке участников интервью. Проверь, что это запись интервью.', retryable: false }
  }
  return { ok: true, table: data }
}
