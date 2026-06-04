import { anthropic, MODEL, MODEL_HAIKU } from '@/lib/ai/client'

// Shared trend-suggestion engine, reused by /api/ai/suggest-trends (on-demand)
// and /api/cron/refresh-trends (weekly auto-refresh).
//
// Two modes:
//   'niche'   — trends tailored to the project's niche (the main function).
//   'popular' — broad, currently-popular trends not tied to the niche, so a user
//               can explore/test formats outside their main topic.
//
// Grounded in: live web search (fast Haiku) + the caller's competitor/reel data.

export const ALLOWED_FORMATS = ['any', 'post', 'reels', 'stories', 'carousel']

export interface TrendCandidate {
  title: string
  description: string
  example: string | null
  format_type: string
}

export interface SuggestTrendsOptions {
  niche?: string
  mode?: 'niche' | 'popular'
  competitorsSummary?: string
  reelsSummary?: string
  existingTitles?: string[]
  count?: number
}

export interface SuggestTrendsResult {
  trends: TrendCandidate[]
  grounded: { web: boolean; competitors: boolean; reels: boolean }
}

function toArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}

export async function suggestTrends(opts: SuggestTrendsOptions): Promise<SuggestTrendsResult> {
  const mode = opts.mode === 'popular' ? 'popular' : 'niche'
  const niche = (opts.niche || '').trim()
  const nicheLabel = niche || 'блогеры/эксперты (общая ниша)'
  const competitorsSummary = opts.competitorsSummary || ''
  const reelsSummary = opts.reelsSummary || ''
  const existingTitles = opts.existingTitles || []
  const count = opts.count || 8

  // ── Step 1: live web research (graceful — Haiku does web search ~10x faster) ──
  let webResearch = ''
  try {
    const searchPrompt = mode === 'popular'
      ? `Найди в интернете самые АКТУАЛЬНЫЕ тренды контента в Instagram и соцсетях прямо сейчас (за последний месяц), В ЦЕЛОМ по платформе, не привязываясь к конкретной нише: залетающие форматы рилз, темы, хуки, структуры, аудио/визуальные тренды, механики вовлечения. Кратко перечисли 8–10 пунктов — что СЕЙЧАС работает у самых разных блогеров, с конкретикой.`
      : `Найди в интернете АКТУАЛЬНЫЕ тренды контента для Instagram и соцсетей в нише «${nicheLabel}» за последние 1–2 месяца: залетающие форматы рилз, темы, хуки, структуры, аудио/визуальные тренды. Кратко перечисли 6–10 пунктов — что СЕЙЧАС работает, с конкретикой. Только то, что реально актуально сейчас, без воды.`
    const searchRes = await anthropic.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 1500,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 } as any],
      messages: [{ role: 'user', content: searchPrompt }],
    })
    webResearch = searchRes.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n').trim()
  } catch (e) {
    console.warn('[suggestTrends] web search skipped:', e instanceof Error ? e.message : e)
  }

  // ── Step 2: synthesise a clean structured list (forced tool) ──────────────────
  const groundBlocks = [
    webResearch ? `СВЕЖИЕ ТРЕНДЫ ИЗ ИНТЕРНЕТА (за последний месяц):\n${webResearch}` : '',
    competitorsSummary ? `ЧТО ДЕЛАЮТ КОНКУРЕНТЫ (реальные посты из их Instagram):\n${competitorsSummary}` : '',
    reelsSummary ? `ЗАЛЕТЕВШИЕ РИЛЗ (разбор: хук/структура/почему зашло):\n${reelsSummary}` : '',
    existingTitles.length ? `УЖЕ ДОБАВЛЕННЫЕ ТРЕНДЫ (НЕ повторяй их):\n${existingTitles.map(t => `- ${t}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')

  const target = mode === 'popular'
    ? `популярные сейчас тренды контента (можно протестировать в любой нише, не обязательно «${nicheLabel}»)`
    : `конкретные тренды месяца для ниши «${nicheLabel}»`

  const prompt = `Ты — тренд-аналитик сервиса AMA для блогеров. Предложи ${count} ${target}, которые блогер может сразу применить в контенте.

${groundBlocks || '(Дополнительных данных нет — опирайся на проверенные залетающие форматы.)'}

ПРАВИЛА:
- Каждый тренд — это формат/тема/структура, а не абстракция. Конкретно и применимо.
- Опирайся на свежие данные выше (интернет, конкуренты, залетевшие рилз). Если данных мало — бери проверенные форматы, но не выдумывай несуществующие «вирусные» цифры.
- НЕ повторяй уже добавленные тренды.
- title — короткое название (напр. «Формат „Миф vs Правда“», «Рубрика „Один день из…“»).
- description — что это и как использовать, 1–2 предложения, по-человечески.
- example — конкретный пример${mode === 'niche' ? ` под нишу «${nicheLabel}»` : ''}.
- format_type — один из: any, post, reels, stories, carousel.

ОБЯЗАТЕЛЬНО верни минимум ${count} трендов через инструмент propose_trends. НЕ возвращай пустой список.`

  const toolDef = {
    name: 'propose_trends',
    description: 'Список предложенных трендов месяца',
    input_schema: {
      type: 'object' as const,
      properties: {
        trends: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              example: { type: 'string' },
              format_type: { type: 'string', description: 'any | post | reels | stories | carousel' },
            },
            required: ['title', 'description'],
          },
        },
      },
      required: ['trends'],
    },
  }

  // The forced tool call INTERMITTENTLY comes back with an empty trends array
  // (~1 in 3). Retry until we get a non-empty list.
  let raw: Array<Record<string, unknown>> = []
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      tools: [toolDef],
      tool_choice: { type: 'tool' as const, name: 'propose_trends' },
      messages: [{ role: 'user', content: prompt }],
    })
    const toolBlock = response.content.find(b => b.type === 'tool_use')
    if (toolBlock && toolBlock.type === 'tool_use') {
      raw = toArray((toolBlock.input as { trends?: unknown }).trends) as Array<Record<string, unknown>>
    }
    if (raw.length > 0) break
    console.warn(`[suggestTrends] empty result, retry ${attempt + 1}/4 (mode=${mode}, stop=${response.stop_reason})`)
  }

  const valid: TrendCandidate[] = []
  for (const t of raw) {
    const title = String(t.title ?? '').trim()
    const description = String(t.description ?? '').trim()
    if (!title || !description) continue
    const fmt = String(t.format_type ?? 'any').toLowerCase()
    valid.push({
      title,
      description,
      example: (String(t.example ?? '').trim()) || null,
      format_type: ALLOWED_FORMATS.includes(fmt) ? fmt : 'any',
    })
  }
  const seen = new Set(existingTitles.map(t => t.trim().toLowerCase()))
  const deduped = valid.filter(c => !seen.has(c.title.toLowerCase()))
  const trends = deduped.length > 0 ? deduped : valid

  return { trends, grounded: { web: !!webResearch, competitors: !!competitorsSummary, reels: !!reelsSummary } }
}
