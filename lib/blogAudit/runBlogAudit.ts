import { anthropic, MODEL } from '@/lib/ai/client'
import { CHECKLIST, diagnose } from '@/lib/blogAudit/checklist'

// ── Результат диагностики ────────────────────────────────────────────────────
export interface AuditItemResult {
  label: string
  assessable: boolean    // оценивали ли по тексту (false → «проверим на консультации»)
  score: number | null   // 0–2, либо null для неоцениваемых
  note: string           // короткий вывод / чего не хватает
}
export interface AuditBlockResult {
  key: string
  title: string
  items: AuditItemResult[]
  scored: number         // сумма оценённых пунктов блока
  assessableMax: number  // максимум по оценённым пунктам блока
}
export interface AuditResult {
  blocks: AuditBlockResult[]
  scored: number         // сумма по всем оценённым пунктам
  assessableMax: number  // максимум по оценённым пунктам (обычно 72 из 100)
  score100: number       // нормализовано к 100 — для диагноза и заголовка
  score10: number        // нормализовано к 10 (headline «X из 10»)
  diagnosis: string
  summary: string        // 1–2 предложения общий вердикт
  topGaps: string[]      // 3–6 самых важных пробелов (для юзера)
  notAssessableCount: number
  handle: string
}

const SYSTEM = `Ты — жёсткий, но честный маркетолог-эксперт по упаковке Instagram-блогов к продажам.
Тебе дают ТЕКСТ профиля: шапку (bio) и подписи к последним постам. Ты НЕ видишь картинки,
визуал, актуальные (highlights), сторис и то, куда ведёт ссылка из шапки. Оценивай ТОЛЬКО то,
что реально видно из текста. Не выдумывай того, чего в тексте нет. Оценки ставь строго и по делу:
0 — нет совсем, 1 — есть частично/слабо, 2 — сделано хорошо. Отвечай ТОЛЬКО валидным JSON.`

function buildPrompt(handle: string, profileText: string): string {
  const blocks = CHECKLIST.map(b => {
    const items = b.items
      .map((it, i) => {
        const tag = it.fromText ? '' : '  [НЕ ВИДНО ИЗ ТЕКСТА — верни score: null]'
        return `    ${i}. ${it.label}${tag}`
      })
      .join('\n')
    return `"${b.key}" — ${b.title}:\n${items}`
  }).join('\n\n')

  return `Профиль: @${handle}

=== ТЕКСТ ПРОФИЛЯ (шапка + последние посты) ===
${profileText.slice(0, 24000)}
=== КОНЕЦ ТЕКСТА ===

Оцени профиль по чек-листу «блог к продажам». Блоки и пункты (индексация с 0):

${blocks}

Для КАЖДОГО пункта верни объект { "score": 0|1|2|null, "note": "..." }:
- score 0–2 — если пункт можно оценить по тексту (0 нет / 1 слабо / 2 хорошо).
- score null — ТОЛЬКО для пунктов, помеченных «[НЕ ВИДНО ИЗ ТЕКСТА]».
- note — 1 короткая фраза по-русски: что именно есть или чего не хватает (обращайся на «ты»).

Также верни:
- "topGaps": массив из 3–6 САМЫХ важных пробелов, которые сильнее всего мешают блогу продавать
  (короткие конкретные фразы для автора блога, на «ты», без воды).
- "summary": 1–2 предложения — общий честный вердикт по блогу.

Формат ответа — СТРОГО такой JSON, без markdown, без пояснений вокруг:
{
  "blocks": {
    "audience":    [ {"score":2,"note":"..."}, {"score":1,"note":"..."}, ... (5 пунктов) ],
    "positioning": [ ... 5 ... ],
    "header":      [ ... 5 ... ],
    "funnel":      [ ... 5 ... ],
    "highlights":  [ ... 5 ... ],
    "cases":       [ ... 5 ... ],
    "content":     [ ... 5 ... ],
    "warmup":      [ ... 5 ... ],
    "visual":      [ ... 5 ... ],
    "clarity":     [ ... 5 ... ]
  },
  "topGaps": ["...", "..."],
  "summary": "..."
}`
}

// Достаём JSON из ответа модели (снимаем возможные ```json-заборы, берём первый {…}).
function parseJson(text: string): unknown {
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  const first = t.indexOf('{')
  const last = t.lastIndexOf('}')
  if (first === -1 || last === -1 || last < first) throw new Error('no-json')
  return JSON.parse(t.slice(first, last + 1))
}

function clampScore(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(2, n))
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * Прогоняет текст профиля через Claude по чек-листу и собирает структурный
 * результат. Арифметику (суммы, нормализацию, диагноз) считаем ЗДЕСЬ, а не
 * доверяем модели. `fromText:false` пункты не оцениваются принципиально —
 * их честно помечаем неоцениваемыми (даже если модель что-то вернула).
 */
export async function runBlogAudit(handle: string, profileText: string): Promise<AuditResult> {
  const resp = await anthropic.messages.create({
    model:      MODEL,
    max_tokens: 4000,
    system:     SYSTEM,
    messages:   [{ role: 'user', content: buildPrompt(handle, profileText) }],
  })
  const raw = resp.content.map(b => (b.type === 'text' ? b.text : '')).join('\n')

  let parsed: {
    blocks?: Record<string, Array<{ score?: unknown; note?: unknown }>>
    topGaps?: unknown
    summary?: unknown
  }
  try {
    parsed = parseJson(raw) as typeof parsed
  } catch {
    throw new Error('Не удалось разобрать ответ анализа. Попробуй ещё раз.')
  }

  const modelBlocks = parsed.blocks ?? {}

  const blocks: AuditBlockResult[] = CHECKLIST.map(block => {
    const modelItems = Array.isArray(modelBlocks[block.key]) ? modelBlocks[block.key] : []
    let scored = 0
    let assessableMax = 0
    const items: AuditItemResult[] = block.items.map((item, i) => {
      const mi = modelItems[i] ?? {}
      const note = asString(mi.note)
      if (!item.fromText) {
        // Принципиально не оцениваем — скрейп этого не видит.
        return { label: item.label, assessable: false, score: null, note: note || 'Проверим вручную на консультации' }
      }
      const score = clampScore(mi.score)
      if (score === null) {
        // Модель не смогла оценить видимый пункт — считаем как 0 (пробел),
        // но помечаем assessable, чтобы он влиял на балл и попадал в разбор.
        scored += 0
        assessableMax += 2
        return { label: item.label, assessable: true, score: 0, note: note || 'Не найдено в тексте профиля' }
      }
      scored += score
      assessableMax += 2
      return { label: item.label, assessable: true, score, note }
    })
    return { key: block.key, title: block.title, items, scored, assessableMax }
  })

  const scored = blocks.reduce((s, b) => s + b.scored, 0)
  const assessableMax = blocks.reduce((s, b) => s + b.assessableMax, 0)
  const score100 = assessableMax > 0 ? Math.round((scored / assessableMax) * 100) : 0
  const score10 = Math.round((score100 / 10) * 10) / 10
  const notAssessableCount = blocks.reduce(
    (n, b) => n + b.items.filter(it => !it.assessable).length, 0,
  )

  const topGaps = Array.isArray(parsed.topGaps)
    ? parsed.topGaps.map(asString).filter(Boolean).slice(0, 6)
    : []

  return {
    blocks,
    scored,
    assessableMax,
    score100,
    score10,
    diagnosis: diagnose(score100),
    summary: asString(parsed.summary) || 'Разбор блога готов.',
    topGaps,
    notAssessableCount,
    handle,
  }
}
