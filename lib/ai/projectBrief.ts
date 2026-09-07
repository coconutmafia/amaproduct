// «Память проекта» — выжимка ВСЕХ материалов в компактный бриф (07.09).
//
// Замер Даши: 80% цены чата — запись 155 тыс. токенов сырья в кэш при первом
// сообщении после перерыва. Как у claude.ai: короткая память про проект +
// подбор деталей под вопрос, а не все документы в каждом сообщении. Бриф
// строится один раз из ПОЛНЫХ материалов (Opus 5, окно 1M) и пересобирается,
// когда материалы меняются (source_hash). Цитаты аудитории — дословно,
// отдельным разделом: за них судья и клиенты ценят ответы.
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { anthropic, MODEL } from '@/lib/ai/client'
import { MASTER_RESEARCH_TITLE } from '@/lib/researchMaster'
import { RAW_LIMIT, DEFAULT_RAW_LIMIT } from '@/lib/ai/rag'

// Ниже этого объёма постоянного слоя бриф не окупается — слой и так маленький.
export const BRIEF_MIN_LAYER_CHARS = 60_000
// Потолок входа генератора (≈180 тыс. токенов): сырые расшифровки режем первыми.
export const BRIEF_INPUT_MAX_CHARS = 420_000
export const BRIEF_MAX_OUTPUT_TOKENS = 24_000
// Не чаще одного джоба на проект за это окно — загрузка 12 расшифровок подряд
// не должна запускать 12 пересборок.
export const BRIEF_JOB_DEBOUNCE_MS = 15 * 60 * 1000
// Типы, которые остаются в стабильном слое ЦЕЛИКОМ и при брифе (короткие и
// критичные для голоса); остальное — в брифе и в подборе под вопрос.
export const BRIEF_KEEP_TYPES = new Set(['tone_of_voice', 'tov', 'blog_lines'])

export interface MaterialIndexRow { id: string; material_type: string; title: string; len: number; status: string | null }

/** Ключ состояния материалов: любое изменение → бриф устарел. */
export function briefSourceHash(project: { name?: string | null; niche?: string | null; description?: string | null; content_language?: string | null }, index: MaterialIndexRow[]): string {
  const rows = [...index]
    .filter(r => r.status == null || r.status === 'ready' || r.status === 'done' || r.status === '')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(r => `${r.id}|${r.material_type}|${r.title}|${r.len}`)
  const head = `${project.name ?? ''}|${project.niche ?? ''}|${project.description ?? ''}|${project.content_language ?? ''}`
  return createHash('sha1').update(head + '\n' + rows.join('\n')).digest('hex').slice(0, 24)
}

/** Объём стабильного слоя (как его собрал бы RAG, без расшифровок) — нужен ли бриф вообще. */
export function stableLayerChars(index: MaterialIndexRow[]): number {
  let total = 0
  for (const r of index) {
    if (r.material_type === 'interview_transcript') continue
    if (r.title === MASTER_RESEARCH_TITLE) continue
    total += Math.min(r.len, RAW_LIMIT[r.material_type] ?? DEFAULT_RAW_LIMIT)
  }
  return total
}

// Порядок важности при усечении входа генератора: что режем ПОСЛЕДНИМ — сверху.
const INPUT_PRIORITY = [
  'tone_of_voice', 'voice_rules', 'product_description', 'funnel_description', 'marketing_strategy', 'marketing_tactics',
  'blog_lines', 'meanings_map', 'unpacking_map', 'cases_reviews', 'audience_research', 'audience_survey',
  'my_instagram', 'competitors', 'content_reference', 'chatbot_description', 'additional', 'other', 'interview_transcript',
]
const TYPE_RU: Record<string, string> = {
  tone_of_voice: 'Tone of Voice', voice_rules: 'Правила голоса от блогера', product_description: 'Продукт', funnel_description: 'Воронка',
  marketing_strategy: 'Стратегия', marketing_tactics: 'Тактики', blog_lines: 'Линии блога', meanings_map: 'Карта смыслов',
  unpacking_map: 'Распаковка личности', cases_reviews: 'Кейсы и отзывы', audience_research: 'Таблица исследования аудитории',
  audience_survey: 'Опрос аудитории', my_instagram: 'Анализ своего Instagram', competitors: 'Конкурент', content_reference: 'Референс контента',
  chatbot_description: 'Чат-бот', additional: 'Дополнительно', other: 'Прочее', interview_transcript: 'Расшифровка кастдева',
}

export const BRIEF_SYSTEM = `Ты — редактор-аналитик. Из материалов проекта блогера/эксперта ты собираешь «ПАМЯТЬ ПРОЕКТА»: компактную выжимку, по которой другой AI будет писать контент в голосе этого человека и словами его аудитории, НЕ видя исходных материалов.

ЖЕЛЕЗНЫЕ ПРАВИЛА:
- Только факты из материалов. Ничего не выдумывай, не «улучшай», не обобщай до банальностей. Нет данных — так и пиши в разделе 9.
- Цитаты аудитории и клиентов — ДОСЛОВНО, как в материалах (с их ошибками и словечками), с пометкой кто говорит (имя или сегмент) и о чём (боль / желание / возражение / результат / критерий выбора). Цитаты — главная ценность памяти, не экономь на них: 40–80 штук, коротких (1–2 предложения каждая).
- Фирменные слова и обороты самого блогера — дословно.
- Цифры, цены, сроки, форматы, названия — точно как в материалах.
- Язык разделов — русский; цитаты и фирменные слова — на языке оригинала.
- БЕЗ markdown: никаких **, ##, таблиц, ---. Только заголовки разделов КАПСОМ с номером, простые строки и списки через «—».
- Объём всей памяти: 40–60 тысяч знаков. Если материалов мало — короче, но не добавляй воду.

СТРУКТУРА (ровно эти разделы, в этом порядке):
1. ЭКСПЕРТ И ПРОЕКТ — кто, ниша, позиционирование, в чём его сила (из распаковки/кейсов), продукты: название, формат, цена, для кого, что внутри; воронка, если описана.
2. ГОЛОС — 15–25 фирменных слов и оборотов дословно; как строит фразы (ритм, длина абзацев, воздух); эмодзи/капс — да/нет и как; чего в его текстах не бывает; личные правила от блогера, если есть.
3. АУДИТОРИЯ — сегменты (2–6). Для каждого: кто (возраст, ситуация, опыт), точка А (как живёт сейчас, что не устраивает), точка Б (чего хочет), боли, страхи и возражения, критерии выбора, как говорит о себе (2–3 дословных фразы).
4. ЯЗЫК АУДИТОРИИ, ДОСЛОВНО — 40–80 цитат по темам: боли; желания и результаты; возражения и страхи; критерии выбора; отзывы о продукте/эксперте. Формат строки: «цитата» — кто (имя/сегмент), тема.
5. КЕЙСЫ И ОТЗЫВЫ — каждый кейс: кто, точка А, что делали, точка Б с цифрами и сроком, дословная фраза клиента. Отзывы — дословно, кратко.
6. КОНКУРЕНТЫ — по каждому: имя/аккаунт, позиционирование, что у него сильно, что слабо, чем наш эксперт отличается (только из материалов).
7. СТРАТЕГИЯ, ЛИНИИ БЛОГА, ТАКТИКИ — цели запуска, этапы прогрева, линии блога (истории и темы, которые ведёт), рабочие тактики, референсы контента. Компактно, без пересказа методологии.
8. ФАКТЫ И ЦИФРЫ — справочник: цены, сроки, даты, форматы, размеры групп, охваты, названия — всё, что могут спросить точно.
9. ЧЕГО В МАТЕРИАЛАХ НЕТ — явный список: о чём спросят, а данных нет (например, «нет цен на индивидуальные занятия», «нет кейсов с цифрами дохода»). Это защита от выдумок.

Пиши так, чтобы по одной этой памяти автор написал пост, сторис или ответ на вопрос клиента, не заглядывая в исходники.`

export interface BriefInput {
  project: { id: string; name: string; niche: string | null; description: string | null; target_audience?: string | null; content_language?: string | null }
  materials: { material_type: string; title: string; raw_content: string }[]
  products: { name: string; product_type: string | null; price: number | null; currency: string | null; description: string | null }[]
}

function projectHead(input: BriefInput): string {
  const products = input.products.length
    ? `### Продукты (из карточки проекта)\n${input.products.map(p => `- ${p.name}${p.product_type ? ` (${p.product_type})` : ''}${p.price != null ? ` — ${p.price} ${p.currency ?? 'RUB'}` : ''}${p.description ? `: ${p.description}` : ''}`).join('\n')}`
    : ''
  const head = `### Проект\nЭксперт/блогер: ${input.project.name}\nНиша: ${input.project.niche || '—'}\n${input.project.description ? `О проекте: ${input.project.description}\n` : ''}${input.project.target_audience ? `Аудитория (как указал сам): ${input.project.target_audience}\n` : ''}`
  return [head, products].filter(Boolean).join('\n\n')
}

/**
 * Текст материалов выбранных типов с усечением по приоритету: ядро целиком (в
 * пределах бюджета), расшифровки делят остаток поровну — от каждой хоть
 * что-то, а не первые три целиком и остальные никак.
 */
export function assembleBriefInput(input: BriefInput, maxChars = BRIEF_INPUT_MAX_CHARS, types?: Set<string>): { text: string; totalChars: number; truncated: boolean } {
  const mats = input.materials
    .filter(m => m.raw_content && m.raw_content.trim() && m.title !== MASTER_RESEARCH_TITLE)
    .filter(m => !types || types.has(m.material_type))
    .sort((a, b) => INPUT_PRIORITY.indexOf(a.material_type) - INPUT_PRIORITY.indexOf(b.material_type))
  const totalChars = mats.reduce((s, m) => s + m.raw_content.length, 0)
  let budget = maxChars
  const parts: string[] = []
  const core = mats.filter(m => m.material_type !== 'interview_transcript')
  const raws = mats.filter(m => m.material_type === 'interview_transcript')
  for (const m of core) {
    const take = Math.min(m.raw_content.length, Math.max(0, budget))
    if (take <= 0) break
    parts.push(`### ${TYPE_RU[m.material_type] ?? m.material_type}: ${m.title}\n${m.raw_content.slice(0, take)}`)
    budget -= take
  }
  if (raws.length > 0 && budget > 2000) {
    const per = Math.floor(budget / raws.length)
    for (const m of raws) {
      const take = Math.min(m.raw_content.length, per)
      parts.push(`### ${TYPE_RU.interview_transcript}: ${m.title}\n${m.raw_content.slice(0, take)}`)
      budget -= take
    }
  }
  const text = [projectHead(input), ...parts].filter(Boolean).join('\n\n')
  return { text, totalChars, truncated: totalChars > maxChars }
}

// Память собирается ТРЕМЯ параллельными проходами по группам разделов: один
// проход на 270 тыс. токенов входа и 20 тыс. выхода шёл 6–8 минут и не
// влезал в лимит serverless-функции (300 с), а сетевой обрыв стрима убивал
// всё. Три прохода по 5–8 тыс. токенов выхода идут ≈2–3 минуты параллельно,
// каждый со своим входом: голос/продукты/стратегия; аудитория и цитаты
// (таблицы + расшифровки); кейсы/конкуренты/пробелы.
export const BRIEF_PARTS: { key: string; sections: number[]; types: string[]; maxChars: number; maxTokens: number }[] = [
  { key: 'core', sections: [1, 2, 7, 8], types: ['tone_of_voice', 'voice_rules', 'product_description', 'funnel_description', 'marketing_strategy', 'marketing_tactics', 'blog_lines', 'unpacking_map', 'my_instagram', 'content_reference', 'chatbot_description', 'additional', 'other', 'cases_reviews', 'meanings_map'], maxChars: 180_000, maxTokens: 9000 },
  { key: 'audience', sections: [3, 4], types: ['meanings_map', 'audience_research', 'audience_survey', 'interview_transcript', 'unpacking_map', 'product_description'], maxChars: 360_000, maxTokens: 12000 },
  { key: 'proof', sections: [5, 6, 9], types: ['cases_reviews', 'competitors', 'my_instagram', 'product_description', 'audience_research', 'meanings_map', 'marketing_strategy'], maxChars: 180_000, maxTokens: 9000 },
]

const SECTION_TITLES: Record<number, string> = {
  1: 'ЭКСПЕРТ И ПРОЕКТ', 2: 'ГОЛОС', 3: 'АУДИТОРИЯ', 4: 'ЯЗЫК АУДИТОРИИ, ДОСЛОВНО', 5: 'КЕЙСЫ И ОТЗЫВЫ',
  6: 'КОНКУРЕНТЫ', 7: 'СТРАТЕГИЯ, ЛИНИИ БЛОГА, ТАКТИКИ', 8: 'ФАКТЫ И ЦИФРЫ', 9: 'ЧЕГО В МАТЕРИАЛАХ НЕТ',
}

/** Разрезать ответ прохода на разделы по заголовкам «N. ЗАГОЛОВОК». */
export function splitSections(text: string): Map<number, string> {
  const out = new Map<number, string>()
  const re = /^\s*(\d)\.\s+[А-ЯЁA-Z][^\n]*$/gm
  const marks: { n: number; at: number; end: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) marks.push({ n: Number(m[1]), at: m.index, end: m.index + m[0].length })
  for (let i = 0; i < marks.length; i++) {
    const body = text.slice(marks[i].end, i + 1 < marks.length ? marks[i + 1].at : text.length).trim()
    if (body && !out.has(marks[i].n)) out.set(marks[i].n, body)
  }
  return out
}

async function withRetries<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try { return await fn() } catch (e) {
      last = e
      const msg = e instanceof Error ? e.message : String(e)
      // сетевой обрыв / перегруз — повторяем; ошибка запроса (400) — нет
      if (!/terminated|ECONN|EHOSTUNREACH|ETIMEDOUT|socket|overloaded|529|5\d\d|rate/i.test(msg) && !(e instanceof Error && e.name === 'APIConnectionError')) throw e
      await new Promise(r => setTimeout(r, 4000 * (i + 1)))
    }
  }
  throw last
}

async function generatePart(input: BriefInput, part: typeof BRIEF_PARTS[number], index: { material_type: string; title: string }[]): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number }; truncated: boolean; inputChars: number }> {
  const { text, truncated } = assembleBriefInput(input, part.maxChars, new Set(part.types))
  // Для раздела 9 («чего нет») — перечень ВСЕХ материалов проекта, чтобы
  // пробелы оценивались по всему проекту, а не по подмножеству прохода.
  const inventory = part.sections.includes(9)
    ? `\n\n=== ПЕРЕЧЕНЬ ВСЕХ МАТЕРИАЛОВ ПРОЕКТА (для раздела 9) ===\n${index.map(r => `- ${TYPE_RU[r.material_type] ?? r.material_type}: ${r.title}`).join('\n')}`
    : ''
  const ask = `Собери ТОЛЬКО разделы ${part.sections.map(n => `${n}. ${SECTION_TITLES[n]}`).join('; ')} ПАМЯТИ ПРОЕКТА по материалам ниже. Остальные разделы делают другие проходы — не пиши их. Начинай каждый раздел строкой «N. ЗАГОЛОВОК».${truncated ? ' Часть расшифровок усечена по объёму — работай с тем, что есть.' : ''}\n\n=== МАТЕРИАЛЫ ПРОЕКТА ===\n\n${text}${inventory}`
  const msg = await withRetries(async () => {
    const stream = anthropic.messages.stream({
      model: MODEL, max_tokens: part.maxTokens, system: BRIEF_SYSTEM,
      output_config: { effort: 'high' },
      messages: [{ role: 'user', content: ask }],
    } as Parameters<typeof anthropic.messages.stream>[0])
    return stream.finalMessage()
  })
  const out = msg.content.map(b => (b.type === 'text' ? b.text : '')).filter(Boolean).join('\n').trim()
  return { text: out, usage: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens }, truncated, inputChars: text.length }
}

export async function generateProjectBrief(input: BriefInput): Promise<{ brief: string; inputChars: number; truncated: boolean; usage: { input_tokens: number; output_tokens: number } }> {
  const index = input.materials.map(m => ({ material_type: m.material_type, title: m.title }))
  const parts = await Promise.all(BRIEF_PARTS.map(p => generatePart(input, p, index)))
  const sections = new Map<number, string>()
  for (const p of parts) for (const [n, body] of splitSections(p.text)) if (!sections.has(n)) sections.set(n, body)
  const ordered = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(n => sections.has(n)).map(n => `${n}. ${SECTION_TITLES[n]}\n${sections.get(n)}`)
  const brief = ordered.join('\n\n').trim()
  if (ordered.length < 5 || brief.length < 2000) throw new Error(`brief incomplete: ${ordered.length} sections, ${brief.length} chars`)
  return {
    brief,
    inputChars: parts.reduce((s, p) => s + p.inputChars, 0),
    truncated: parts.some(p => p.truncated),
    usage: { input_tokens: parts.reduce((s, p) => s + p.usage.input_tokens, 0), output_tokens: parts.reduce((s, p) => s + p.usage.output_tokens, 0) },
  }
}

/** Всё, что нужно генератору, — из базы (сервис-роль: материалы проекта целиком). */
export async function collectBriefInput(admin: SupabaseClient, projectId: string): Promise<{ input: BriefInput; index: MaterialIndexRow[] } | null> {
  // select('*'): явный список колонок ломается в окне «деплой → миграция» (страж content-language.test.ts)
  const { data: project } = await admin.from('projects').select('*').eq('id', projectId).maybeSingle()
  if (!project) return null
  const [{ data: mats }, { data: products }] = await Promise.all([
    admin.from('project_materials').select('id, material_type, title, raw_content, processing_status').eq('project_id', projectId),
    admin.from('products').select('name, product_type, price, currency, description, is_active').eq('project_id', projectId),
  ])
  const usable = (mats ?? []).filter(m => m.processing_status == null || m.processing_status === 'ready' || m.processing_status === 'done')
  const index: MaterialIndexRow[] = (mats ?? []).map(m => ({ id: String(m.id), material_type: String(m.material_type), title: String(m.title ?? ''), len: String(m.raw_content ?? '').length, status: (m.processing_status as string | null) ?? null }))
  return {
    input: {
      project: project as BriefInput['project'],
      materials: usable.map(m => ({ material_type: String(m.material_type), title: String(m.title ?? ''), raw_content: String(m.raw_content ?? '') })),
      products: (products ?? []).filter(p => p.is_active !== false).map(p => ({ name: String(p.name), product_type: (p.product_type as string | null) ?? null, price: p.price == null ? null : Number(p.price), currency: (p.currency as string | null) ?? null, description: (p.description as string | null) ?? null })),
    },
    index,
  }
}

/**
 * Состояние памяти проекта: fresh (тот же source_hash) / stale (нет или
 * устарела) / unavailable (таблицы нет — миграция 049 не применена: в этом
 * случае пересборку НЕ ставим, чтобы не жечь $1–2 на генерацию впустую).
 */
export async function getBriefState(admin: SupabaseClient, projectId: string, sourceHash: string): Promise<{ state: 'fresh'; brief: string } | { state: 'stale' } | { state: 'unavailable' }> {
  try {
    const { data, error } = await admin.from('project_briefs').select('brief, source_hash, status').eq('project_id', projectId).maybeSingle()
    if (error) return /project_briefs|does not exist|schema cache/i.test(error.message) ? { state: 'unavailable' } : { state: 'stale' }
    if (!data || data.status !== 'ready' || data.source_hash !== sourceHash || !data.brief) return { state: 'stale' }
    return { state: 'fresh', brief: String(data.brief) }
  } catch { return { state: 'unavailable' } }
}

/** Свежий бриф или null (обёртка над getBriefState). */
export async function getFreshBrief(admin: SupabaseClient, projectId: string, sourceHash: string): Promise<string | null> {
  const st = await getBriefState(admin, projectId, sourceHash)
  return st.state === 'fresh' ? st.brief : null
}

/** Поставить пересборку в очередь, если за окно её ещё не ставили. true = поставили. */
export async function ensureBriefJob(admin: SupabaseClient, projectId: string, userId: string, sourceHash: string): Promise<string | null> {
  try {
    const since = new Date(Date.now() - BRIEF_JOB_DEBOUNCE_MS).toISOString()
    const { data: recent } = await admin.from('jobs').select('id').eq('project_id', projectId).eq('type', 'project_brief').gte('created_at', since).limit(1)
    if (recent && recent.length > 0) return null
    const { data: job } = await admin.from('jobs').insert({
      user_id: userId, project_id: projectId, type: 'project_brief', status: 'queued', payload: { projectId, sourceHash },
    }).select('id').single()
    return (job?.id as string) ?? null
  } catch { return null }
}

/** Секция системного промпта вместо сырых материалов. */
export function renderBriefSection(brief: string): string {
  return `ПАМЯТЬ ПРОЕКТА — выжимка всех материалов проекта (кастдевы, таблицы исследования, карта смыслов, распаковка, кейсы, конкуренты, стратегия). Это и есть материалы: опирайся на неё как на первоисточник. Дословные цитаты аудитории бери из раздела 4, факты и цифры — из раздела 8; чего нет в разделе 9 — того не выдумывай. Под конкретный вопрос ниже могут прийти справочные фрагменты исходников — они дополняют память.

${brief}`
}
