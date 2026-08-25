// Ядро «Анализа конкурентов» (сравнительная таблица из скрейпов Instagram).
// Вынесено из app/api/ai/analyze-competitors 24.08, чтобы фоновый джоб
// (lib/jobs/runCompetitorAnalysisJob.ts) использовал РОВНО ту же логику, что и
// sync-роут (паттерн lib/ai/warmupPlan.ts). Поведение и тексты — байт-в-байт.
import type { SupabaseClient } from '@supabase/supabase-js'
import { captureException } from '@/lib/sentry'
import { anthropic, MODEL, AI_BUSY_MESSAGE } from '@/lib/ai/client'

function toArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}

export interface CompetitorRow {
  handle: string
  followers: string
  topics: string
  formats: string
  what_works: string
  tone: string
  posting: string
  strengths: string
  takeaway: string
}

export type CompetitorAnalysisResult =
  | { ok: true; rows: CompetitorRow[] }
  | { ok: false; error: string }

// Полный прогон: материалы конкурентов → промпт → форс-тул (с ретраями на
// пустой список) → строки таблицы. Ошибки санитизируются здесь (job.error и
// ответ роута читает клиент — граница доверия).
export async function analyzeCompetitors(
  reader: SupabaseClient,
  projectId: string,
): Promise<CompetitorAnalysisResult> {
  try {
    const { data: project } = await reader.from('projects').select('id, niche').eq('id', projectId).single()
    if (!project) return { ok: false, error: 'Проект не найден — обнови страницу и попробуй ещё раз.' }

    const { data: comp } = await reader
      .from('project_materials')
      .select('title, raw_content')
      .eq('project_id', projectId)
      .eq('material_type', 'competitors')
    const competitors = (comp ?? []).filter((c) => (c.raw_content || '').trim())
    if (competitors.length === 0) return { ok: false, error: 'Сначала добавь конкурентов в Instagram (раздел «Конкуренты»).' }

    const { data: mine } = await reader
      .from('project_materials')
      .select('raw_content')
      .eq('project_id', projectId)
      .eq('material_type', 'my_instagram')
      .limit(1)

    const compBlocks = competitors.map((c, i) => `### Конкурент ${i + 1}: ${c.title}\n${(c.raw_content || '').slice(0, 2800)}`).join('\n\n')
    const mineBlock = (mine?.[0]?.raw_content || '').slice(0, 1500)

    const prompt = `Ты — стратег-аналитик контента для блогеров. По данным из Instagram ниже составь СРАВНИТЕЛЬНУЮ ТАБЛИЦУ конкурентов${project.niche ? ` (ниша: «${project.niche}»)` : ''}.

Для КАЖДОГО конкурента заполни поля кратко и по делу (без воды):
- handle — ник (@…)
- followers — число подписчиков (как в данных, можно «~30k»)
- topics — основные темы/рубрики контента
- formats — какие форматы использует (рилз/карусели/посты/сторис) и на чём акцент
- what_works — что у него ЗАХОДИТ (по охватам/лайкам/комментам — конкретные темы/механики)
- tone — тон и подача (экспертный/лайфстайл/провокация и т.п.)
- posting — регулярность/частота, если видно
- strengths — сильные стороны
- takeaway — ВЫВОД для нашего блогера: что перенять и чем отстроиться${mineBlock ? ' (учитывая его аккаунт ниже)' : ''}

${mineBlock ? `НАШ АККАУНТ (для вывода):\n${mineBlock}\n\n` : ''}ДАННЫЕ КОНКУРЕНТОВ:\n${compBlocks}

Верни РОВНО ${competitors.length} строк через инструмент competitor_analysis (по одной на конкурента). Не возвращай пустой список.`

    const tool = {
      name: 'competitor_analysis',
      description: 'Сравнительная таблица конкурентов',
      input_schema: {
        type: 'object' as const,
        properties: {
          competitors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                handle: { type: 'string' }, followers: { type: 'string' }, topics: { type: 'string' },
                formats: { type: 'string' }, what_works: { type: 'string' }, tone: { type: 'string' },
                posting: { type: 'string' }, strengths: { type: 'string' }, takeaway: { type: 'string' },
              },
              required: ['handle'],
            },
          },
        },
        required: ['competitors'],
      },
    }

    // Forced tool calls intermittently return an empty array — retry until non-empty.
    let raw: Array<Record<string, unknown>> = []
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 10000,
        tools: [tool],
        tool_choice: { type: 'tool' as const, name: 'competitor_analysis' },
        messages: [{ role: 'user', content: prompt }],
      })
      const block = res.content.find((b) => b.type === 'tool_use')
      if (block && block.type === 'tool_use') raw = toArray((block.input as { competitors?: unknown }).competitors) as Array<Record<string, unknown>>
      if (raw.length > 0) break
      console.warn(`[analyze-competitors] empty result, retry ${attempt + 1}/4`)
    }

    const s = (v: unknown) => String(v ?? '').trim()
    const rows: CompetitorRow[] = raw
      .map((r) => ({
        handle: s(r.handle), followers: s(r.followers), topics: s(r.topics), formats: s(r.formats),
        what_works: s(r.what_works), tone: s(r.tone), posting: s(r.posting), strengths: s(r.strengths), takeaway: s(r.takeaway),
      }))
      .filter((r) => r.handle)

    if (rows.length === 0) return { ok: false, error: 'Не удалось сделать анализ — попробуй ещё раз.' }
    return { ok: true, rows }
  } catch (e) {
    console.error('[analyze-competitors]', e instanceof Error ? e.message : e)
    await captureException(e, { where: 'analyze-competitors', projectId })
    return { ok: false, error: AI_BUSY_MESSAGE }
  }
}
