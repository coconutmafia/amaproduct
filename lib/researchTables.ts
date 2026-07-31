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
export function audienceResearchToPivotAoa(text: string): string[][] {
  const out = parseResearch(text)
  if (out.length === 0) return []
  const questions: string[] = []
  const seenQ = new Set<string>()
  type P = { label: string; name: string; seg: string; answers: Map<string, string> }
  const order: P[] = []
  const byKey = new Map<string, P>()
  for (const r of out) {
    if (!seenQ.has(r.q)) { seenQ.add(r.q); questions.push(r.q) }
    const key = `${r.label}::${r.name}::${r.seg}`
    let p = byKey.get(key)
    if (!p) { p = { label: r.label, name: r.name, seg: r.seg, answers: new Map() }; byKey.set(key, p); order.push(p) }
    if (!p.answers.has(r.q)) p.answers.set(r.q, r.a)
  }
  const hasLabel = order.some((p) => p.label)
  const head = [...(hasLabel ? ['Кастдев'] : []), 'Участник', 'Сегмент', ...questions]
  const rows = order.map((p) => [...(hasLabel ? [p.label] : []), p.name, p.seg, ...questions.map((q) => p.answers.get(q) ?? '')])
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
// Тип | Категория | Формулировки участников | Идеи контента, grouped by type.
// Stored block format: "[TYPE] Категория:\nФормулировки: …\nГлубинный триггер:
// …\nВозражение: …\nИдея контента: …" (blocks split by blank lines).
const MEANING_TYPE_RU: Record<string, string> = {
  PAIN: 'Боль',
  NEED: 'Потребность',
  TRIGGER: 'Триггер',
  OBJECTION: 'Возражение',
  ADVANTAGE: 'Преимущества эксперта',
  BENEFIT: 'Преимущества эксперта',
}
const MEANING_ORDER = ['PAIN', 'NEED', 'TRIGGER', 'OBJECTION', 'ADVANTAGE', 'BENEFIT']

export function meaningsMapToAoa(text: string): string[][] {
  type Row = { type: string; cat: string; words: string; idea: string }
  const parsed: Row[] = []
  for (const block of text.split(/\n\s*\n+/)) {
    const header = block.match(/^\[(.+?)\]\s*(.+?):?\s*$/m)
    if (!header) continue
    parsed.push({
      type: header[1].trim().toUpperCase(),
      cat: header[2].trim(),
      words: block.match(/Формулировки:\s*(.+)/)?.[1]?.trim() ?? '',
      idea: block.match(/Идея контента:\s*(.+)/)?.[1]?.trim() ?? '',
    })
  }
  if (parsed.length === 0) return []
  const rank = (t: string) => { const i = MEANING_ORDER.indexOf(t); return i < 0 ? 99 : i }
  parsed.sort((a, b) => rank(a.type) - rank(b.type))
  // Шапка 1-в-1 из урока «Карта смыслов» (4 столбца методологии): Категория |
  // Общая формулировка | Формулировки клиентов | Идеи контента. Наш «Тип»
  // (Боль/Потребность/…) и есть «Категория» урока; наша «Категория» — её
  // «Общая формулировка». Команда сверяет глазами с уроком — имена совпадают.
  const rows: string[][] = [['Категория', 'Общая формулировка', 'Формулировки клиентов', 'Идеи контента']]
  for (const p of parsed) rows.push([MEANING_TYPE_RU[p.type] ?? p.type, p.cat, p.words, p.idea])
  return rows
}
