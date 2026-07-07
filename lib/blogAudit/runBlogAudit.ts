import { anthropic, MODEL, MODEL_HAIKU } from '@/lib/ai/client'
import { CHECKLIST, diagnose } from '@/lib/blogAudit/checklist'
import { IMAGE_URLS_HEADER } from '@/lib/instagram/scrapeAccount'

type ImageBlock = { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string } }

// Pull the appended image URLs (avatar + post covers) out of a stored profile.
function imageUrlsFromText(text: string): string[] {
  const idx = text.indexOf(IMAGE_URLS_HEADER)
  if (idx === -1) return []
  return text.slice(idx).split('\n').map(l => l.trim()).filter(l => /^https?:\/\//.test(l)).slice(0, 4)
}

// Fetch one image → base64 block for Claude vision. Skips oversized/failed.
async function fetchImageBlock(url: string): Promise<ImageBlock | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AMAproduct/1.0)' },
    })
    if (!res.ok) return null
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    const media_type = ct.includes('png') ? 'image/png' : ct.includes('webp') ? 'image/webp' : ct.includes('gif') ? 'image/gif' : 'image/jpeg'
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > 4_500_000) return null
    return { type: 'image', source: { type: 'base64', media_type, data: buf.toString('base64') } }
  } catch { return null }
}

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

// A block/item is visible to the model when it's text-assessable, or it's the
// visual block and we attached profile images for it to look at.
function itemVisible(blockKey: string, fromText: boolean, hasImages: boolean): boolean {
  return fromText || (hasImages && blockKey === 'visual')
}

function buildPrompt(handle: string, profileText: string, hasImages: boolean): string {
  const blocks = CHECKLIST.map(b => {
    const items = b.items
      .map((it, i) => {
        const tag = itemVisible(b.key, it.fromText, hasImages) ? '' : '  [НЕ ВИДНО ИЗ ТЕКСТА — верни score: null]'
        return `    ${i}. ${it.label}${tag}`
      })
      .join('\n')
    return `"${b.key}" — ${b.title}:\n${items}`
  }).join('\n\n')

  const imagesNote = hasImages
    ? '\nК сообщению приложены изображения профиля (аватар и обложки последних постов). Блок "visual" (Визуальная упаковка) оцени ПО ЭТИМ ИЗОБРАЖЕНИЯМ: единство концепции, фирменные цвета, шрифты, узнаваемые элементы, соответствие ЦА.\n'
    : ''

  return `Профиль: @${handle}
${imagesNote}

=== ТЕКСТ ПРОФИЛЯ (шапка + последние посты) ===
${profileText.slice(0, 24000)}
=== КОНЕЦ ТЕКСТА ===

Оцени профиль по чек-листу «блог к продажам». Блоки и пункты (индексация с 0):

${blocks}

ВАЖНО — не выдумывай пробелы, которых нет. Первая строка Bio — это «жирная строка» профиля.
Внимательно перечитай Bio и посты ПЕРЕД тем, как отметить что-то отсутствующим: если город/локация,
ниша, услуга, ссылка, оффер, продукт или CTA уже есть в тексте — НЕ считай это пробелом, НЕ занижай балл
и НЕ советуй это добавить. Рекомендации давай только по тому, чего в профиле реально нет.

Для КАЖДОГО пункта верни объект { "score": 0|1|2|null, "note": "..." }:
- score 0–2 — если пункт можно оценить по тексту (0 нет / 1 слабо / 2 хорошо).
- score null — ТОЛЬКО для пунктов, помеченных «[НЕ ВИДНО ИЗ ТЕКСТА]».
- note — 1 короткая фраза по-русски: что именно есть или чего не хватает (обращайся на «ты»).

Также верни:
- "topGaps": массив из 3–6 САМЫХ важных пробелов, которые сильнее всего мешают блогу продавать
  (короткие конкретные фразы для автора блога, на «ты», без воды). НЕ включай то, что в профиле уже есть.
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

// Второй проход (дёшево, на Haiku): выкидывает рекомендации, которые противоречат
// профилю — советуют добавить то, что УЖЕ есть (тестер поймала кейс: город есть в
// жирной строке, а совет «добавь город»). Best-effort: при сбое отдаём исходные.
async function verifyGaps(profileText: string, gaps: string[]): Promise<string[]> {
  if (gaps.length === 0) return gaps
  try {
    const resp = await anthropic.messages.create({
      model:      MODEL_HAIKU,
      max_tokens: 1200,
      system:     'Ты придирчивый редактор. Тебе дают текст Instagram-профиля и список рекомендаций «что улучшить». Убери те рекомендации, которые советуют добавить то, что в профиле УЖЕ ЕСТЬ (город/локация, ниша, услуга, ссылка, оффер, продукт, CTA, цифры/соц-доказательство и т.п.). Ничего нового не придумывай, формулировки оставшихся не меняй. Отвечай только JSON.',
      messages:   [{ role: 'user', content: `ТЕКСТ ПРОФИЛЯ:\n${profileText.slice(0, 12000)}\n\nРЕКОМЕНДАЦИИ:\n${gaps.map((g, i) => `${i + 1}. ${g}`).join('\n')}\n\nВерни строго JSON вида {"gaps": ["...", ...]} — оставь ТОЛЬКО те рекомендации, которых в профиле реально не хватает по тексту выше. Порядок сохрани.` }],
    })
    const raw = resp.content.map(b => (b.type === 'text' ? b.text : '')).join('\n')
    const parsed = parseJson(raw) as { gaps?: unknown }
    if (Array.isArray(parsed.gaps)) {
      const cleaned = parsed.gaps.map(asString).filter(Boolean)
      // Не отдаём пустоту, если верификатор перестарался/сломался.
      if (cleaned.length > 0) return cleaned.slice(0, 6)
    }
  } catch { /* верификация best-effort */ }
  return gaps
}

/**
 * Прогоняет текст профиля через Claude по чек-листу и собирает структурный
 * результат. Арифметику (суммы, нормализацию, диагноз) считаем ЗДЕСЬ, а не
 * доверяем модели. `fromText:false` пункты не оцениваются принципиально —
 * их честно помечаем неоцениваемыми (даже если модель что-то вернула).
 */
export async function runBlogAudit(handle: string, profileText: string): Promise<AuditResult> {
  // Load a few profile images (avatar + post covers) so the model can score the
  // "visual" block. Older accounts scraped before image capture have no URLs →
  // no images → visual stays "на консультации" (graceful).
  const imageBlocks = (await Promise.all(imageUrlsFromText(profileText).map(fetchImageBlock))).filter((b): b is ImageBlock => b !== null)
  const hasImages = imageBlocks.length > 0

  const textBlock = { type: 'text' as const, text: buildPrompt(handle, profileText, hasImages) }
  const resp = await anthropic.messages.create({
    model:      MODEL,
    max_tokens: 4000,
    system:     SYSTEM,
    messages:   [{ role: 'user', content: hasImages ? [...imageBlocks, textBlock] : [textBlock] }],
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
      if (!itemVisible(block.key, item.fromText, hasImages)) {
        // Не оцениваем автоматически — этого не видно с поверхности профиля
        // (актуальные, визуал без картинок, назначение ссылки). Единая честная
        // формулировка (просил тестер) вместо разнородного «не видно…».
        return { label: item.label, assessable: false, score: null, note: 'Обсуждается на консультации' }
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

  const rawGaps = Array.isArray(parsed.topGaps)
    ? parsed.topGaps.map(asString).filter(Boolean).slice(0, 6)
    : []
  // Проверяем рекомендации на противоречие профилю (второй проход).
  const topGaps = await verifyGaps(profileText, rawGaps)

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
