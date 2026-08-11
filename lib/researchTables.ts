// Pure parsers that turn the TEXT-format research materials (saved by
// research-analyze into project_materials.raw_content) into clean 2-D tables
// (array-of-arrays) ready for XLSX export. Kept pure (no DOM) so they're unit-
// testable against real stored content.

// ── Audience research → ВЕРТИКАЛЬНАЯ таблица (строка = вопрос-ответ) ─────────
// Исторически была сводка «участник = строка, вопросы = колонки»: при 33
// вопросах она нечитаема, а на «Общей таблице кастдевов» ломалась совсем —
// мастер разделяет интервью заголовками «═══ Кастдев от N июля ═══» (без
// "\n---\n", которых ждал парсер), и ВСЕ интервью слипались в одну строку
// первого участника (файл Матвея 31 июля: 2 строки × 99 колонок). Теперь
// построчный разбор обоих форматов:
//   [═══ Кастдев от N июля ═══]        ← только в мастере
//   Участник: ИМЯ (СЕГМЕНТ)            ← сегмент бывает со вложенными скобками
//     Вопрос: … / Ответ: …(многострочный) / Цитаты: … / Тон: …
// Разделители участников: «═══…═══», «---» или следующий «Участник:».
interface ResearchQA { label: string; name: string; seg: string; q: string; a: string; quotes: string; tone: string }

function parseResearch(text: string): ResearchQA[] {
  type QA = { q: string; field: 'a' | 'other' | null; a: string[]; quotes: string; tone: string }
  const out: ResearchQA[] = []
  let label = ''
  let name = ''
  let seg = ''
  let cur: QA | null = null
  const flush = () => {
    if (cur?.q) out.push({ label, name, seg, q: cur.q, a: cur.a.join('\n').trim(), quotes: cur.quotes, tone: cur.tone })
    cur = null
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const h = line.match(/^═+\s*(.*?)\s*═+$/)
    if (h) { flush(); label = h[1]; continue }
    if (/^-{3,}$/.test(line)) { flush(); continue }
    const u = line.match(/^Участник:\s*(.+)$/)
    if (u) { flush(); [name, seg] = splitNameSegment(u[1]); continue }
    const q = line.match(/^Вопрос:\s*(.*)$/)
    if (q) { flush(); cur = { q: q[1].trim(), field: null, a: [], quotes: '', tone: '' }; continue }
    if (!cur) continue
    const a = line.match(/^Ответ:\s*(.*)$/)
    if (a) { cur.field = 'a'; cur.a.push(a[1]); continue }
    const c = line.match(/^Цитаты:\s*(.*)$/)
    if (c) { cur.field = 'other'; cur.quotes = c[1].trim(); continue }
    const t = line.match(/^Тон:\s*(.*)$/)
    if (t) { cur.field = 'other'; cur.tone = t[1].trim(); continue }
    if (line && cur.field === 'a') cur.a.push(line) // многострочный ответ
  }
  flush()
  return out
}

export function audienceResearchToAoa(text: string): string[][] {
  const out = parseResearch(text)
  if (out.length === 0) return []
  // Колонку «Кастдев» показываем только у мастера (в отдельных таблицах пусто).
  const head = ['Участник', 'Сегмент', 'Вопрос', 'Ответ', 'Цитаты', 'Тон']
  return out.some((r) => r.label)
    ? [['Кастдев', ...head], ...out.map((r) => [r.label, r.name, r.seg, r.q, r.a, r.quotes, r.tone])]
    : [head, ...out.map((r) => [r.name, r.seg, r.q, r.a, r.quotes, r.tone])]
}

// Сводка «как в уроке» (эталон «Касдевы Ава.xlsx» из урока кастдевов, вердикт
// команды 31 июля): строка = участник, колонки = вопросы, ячейка = дословный
// ответ. Уникальность участника — в паре с кастдевом (в мастере имена могут
// повторяться между интервью).
// Нормализованный ключ вопроса: регистр/ё/пунктуация/пробелы не должны
// плодить отдельные колонки (файл Дарьи 11 августа: «…ценностям организации?»
// и «…ценностям организации» были ДВУМЯ колонками, ответы врозь).
function questionKey(q: string): string {
  return q.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim()
}

export function audienceResearchToPivotAoa(text: string): string[][] {
  const out = parseResearch(text)
  if (out.length === 0) return []
  // Группировка вопросов: одинаковые после нормализации — одна колонка;
  // плюс безопасное слияние «один текст — ПОЛНЫЙ префикс другого» (модель
  // часто добавляет хвост «по шкале от 1 до 10» к тому же вопросу). Разные
  // по смыслу вопросы под это правило не попадают.
  type Q = { key: string; title: string }
  const questions: Q[] = []
  const keyOf = (raw: string): string => {
    const k = questionKey(raw)
    const hit = questions.find((q) => q.key === k || q.key.startsWith(k + ' ') || k.startsWith(q.key + ' '))
    if (hit) {
      // Заголовок колонки — самая длинная формулировка группы (полнее);
      // ключ группы стабилен с первого появления (по нему уже лежат ответы).
      if (raw.length > hit.title.length) hit.title = raw
      return hit.key
    }
    questions.push({ key: k, title: raw })
    return k
  }
  type P = { label: string; name: string; seg: string; answers: Map<string, string> }
  const order: P[] = []
  const byKey = new Map<string, P>()
  for (const r of out) {
    const qk = keyOf(r.q)
    const key = `${r.label}::${r.name}::${r.seg}`
    let p = byKey.get(key)
    if (!p) { p = { label: r.label, name: r.name, seg: r.seg, answers: new Map() }; byKey.set(key, p); order.push(p) }
    if (!p.answers.has(qk)) p.answers.set(qk, r.a)
  }
  // Общие вопросы — влево, уникальные для одного участника — вправо: ядро
  // интервью читается сразу, а не тонет среди разреженных колонок (файл
  // Дарьи: 5 общих вопросов и 21 индивидуальный). Порядок стабилен при
  // равенстве (по первому появлению).
  const answeredBy = new Map<string, number>()
  for (const q of questions) answeredBy.set(q.key, order.filter((p) => (p.answers.get(q.key) ?? '').trim() !== '').length)
  const sorted = [...questions].sort((a, b) => (answeredBy.get(b.key) ?? 0) - (answeredBy.get(a.key) ?? 0))

  const hasLabel = order.some((p) => p.label)
  const head = [...(hasLabel ? ['Кастдев'] : []), 'Участник', 'Сегмент', ...sorted.map((q) => q.title)]
  const rows = order.map((p) => [...(hasLabel ? [p.label] : []), p.name, p.seg, ...sorted.map((q) => p.answers.get(q.key) ?? '')])
  return [head, ...rows]
}

// «Игорь (Егор) (Мужчина, 40 лет, живёт в Москве (Россия), …)» → имя может
// содержать скобки, сегмент — вложенные. Сегмент = ПОСЛЕДНЯЯ сбалансированная
// скобочная группа, закрывающаяся в конце строки; ищем её обратным проходом.
function splitNameSegment(s: string): [string, string] {
  const t = s.trim()
  if (t.endsWith(')')) {
    let depth = 0
    for (let i = t.length - 1; i >= 0; i--) {
      if (t[i] === ')') depth++
      else if (t[i] === '(') {
        depth--
        if (depth === 0) return [t.slice(0, i).trim(), t.slice(i + 1, -1).trim()]
      }
    }
  }
  return [t, '']
}

// ── Meaning map → clean 4-column table ────────────────────────────────────────
// Шапка 1-в-1 из урока «Карта смыслов»: Категория | Общая формулировка |
// Формулировка клиента | Идеи контента.
//
// ДВА формата хранения:
//   НОВЫЙ (с 3 августа, строго по уроку): "[БОЛИ] Общая формулировка\n
//     — «формулировка клиента»\n  Идея контента: …" — строка таблицы на КАЖДУЮ
//     формулировку клиента, у каждой своя идея (правило урока).
//   СТАРЫЙ: "[PAIN] Категория:\nФормулировки: a, b\nИдея контента: …" —
//     одна строка на категорию (формулировки слиты) — старые карты в базе.
// Названия и порядок категорий — 1-в-1 со слайдов ВИДЕОУРОКА «Карта смыслов»
// (сверка по кадрам youtu.be/9HYmNJL94yE): слайд «СТОЛБЕЦ 1. КАТЕГОРИЯ» =
// Боли → Хотелки, Потребности → Триггеры → Возражения → Ваши преимущества;
// финальный слайд «4 СТОЛБЦА»: Категория | Общая формулировка | Формулировка
// клиента | Идеи контента. Файл «Касдевы Ава.xlsx» местами отличается (порядок,
// «Формулировки клиентов») — это заполнение клиентки, канон — слайды урока.
const MEANING_TYPE_RU: Record<string, string> = {
  PAIN: 'Боли',
  NEED: 'Хотелки, Потребности',
  TRIGGER: 'Триггеры',
  OBJECTION: 'Возражения',
  ADVANTAGE: 'Ваши преимущества',
  BENEFIT: 'Ваши преимущества',
  // Русские метки в скобках (новый формат) — все исторические варианты.
  'БОЛИ': 'Боли',
  'ХОТЕЛКИ, ПОТРЕБНОСТИ': 'Хотелки, Потребности',
  'ХОТЕЛКИ/ПОТРЕБНОСТИ': 'Хотелки, Потребности',   // карты вечера 3 августа
  'ПОТРЕБНОСТИ И ХОТЕЛКИ': 'Хотелки, Потребности', // карты дня 3 августа
  'ТРИГГЕРЫ': 'Триггеры',
  'ВОЗРАЖЕНИЯ': 'Возражения',
  'ВАШИ ПРЕИМУЩЕСТВА': 'Ваши преимущества',
  'ПРЕИМУЩЕСТВА': 'Ваши преимущества',
}
const MEANING_ORDER = [
  'PAIN', 'БОЛИ',
  'NEED', 'ХОТЕЛКИ, ПОТРЕБНОСТИ', 'ХОТЕЛКИ/ПОТРЕБНОСТИ', 'ПОТРЕБНОСТИ И ХОТЕЛКИ',
  'TRIGGER', 'ТРИГГЕРЫ',
  'OBJECTION', 'ВОЗРАЖЕНИЯ',
  'ADVANTAGE', 'BENEFIT', 'ВАШИ ПРЕИМУЩЕСТВА', 'ПРЕИМУЩЕСТВА',
]

// Шапка — финальный слайд урока «4 СТОЛБЦА» (ед. число «Формулировка клиента»).
const MEANINGS_HEAD = ['Категория', 'Общая формулировка', 'Формулировка клиента', 'Идеи контента']

export function meaningsMapToAoa(text: string): string[][] {
  type Row = { type: string; cat: string; words: string; idea: string }
  const parsed: Row[] = []
  for (const block of text.split(/\n\s*\n+/)) {
    const header = block.match(/^\[(.+?)\]\s*(.+?):?\s*$/m)
    if (!header) continue
    const type = header[1].trim().toUpperCase()
    const cat  = header[2].trim()

    // Новый формат: строки «— «…»» + «Идея контента: …» на каждую формулировку.
    const entries = [...block.matchAll(/^—\s*«?(.+?)»?\s*$(?:\n\s+Идея контента:\s*(.+?)\s*$)?/gm)]
    if (entries.length > 0) {
      for (const e of entries) parsed.push({ type, cat, words: e[1].trim(), idea: (e[2] ?? '').trim() })
      continue
    }

    // Старый формат: «Формулировки: …» одной строкой.
    parsed.push({
      type,
      cat,
      words: block.match(/Формулировки:\s*(.+)/)?.[1]?.trim() ?? '',
      idea: block.match(/Идея контента:\s*(.+)/)?.[1]?.trim() ?? '',
    })
  }
  if (parsed.length === 0) return []
  const rank = (t: string) => { const i = MEANING_ORDER.indexOf(t); return i < 0 ? 99 : i }
  parsed.sort((a, b) => rank(a.type) - rank(b.type))
  const rows: string[][] = [MEANINGS_HEAD]
  for (const p of parsed) rows.push([MEANING_TYPE_RU[p.type] ?? p.type, p.cat, p.words, p.idea])
  return rows
}
