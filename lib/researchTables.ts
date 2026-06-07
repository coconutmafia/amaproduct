// Pure parsers that turn the TEXT-format research materials (saved by
// research-analyze into project_materials.raw_content) into clean 2-D tables
// (array-of-arrays) ready for XLSX export. Kept pure (no DOM) so they're unit-
// testable against real stored content.

// ── Audience research → PIVOT (one row per participant, questions as columns) ──
// Stored format (per respondent, sections split by "\n---\n"):
//   Участник: NAME (SEGMENT)
//     Вопрос: …\n  Ответ: …\n  Цитаты: …\n  Тон: …  (repeated)
export function audienceResearchToAoa(text: string): string[][] {
  type Resp = { name: string; segment: string; answers: Map<string, string> }
  const resps: Resp[] = []
  const questionOrder: string[] = []
  const seenQ = new Set<string>()

  for (const sec of text.split(/\n---\n/)) {
    const header = sec.match(/Участник:\s*(.+?)(?:\s*\((.+?)\))?\s*$/m)
    if (!header) continue
    const name = header[1].trim()
    const segment = (header[2] ?? '').trim()
    const answers = new Map<string, string>()
    const re = /\s*Вопрос:\s*(.+?)\s*\n\s*Ответ:\s*([\s\S]+?)\n\s*Цитаты:\s*(.+?)\n\s*Тон:\s*(.+?)(?=\n\s*\n|\n\s*Вопрос:|$)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(sec)) !== null) {
      const q = m[1].trim()
      if (!seenQ.has(q)) { seenQ.add(q); questionOrder.push(q) }
      answers.set(q, m[2].trim())
    }
    if (answers.size > 0) resps.push({ name, segment, answers })
  }
  if (resps.length === 0) return []
  const rows: string[][] = [['Участник', 'Сегмент', ...questionOrder]]
  for (const r of resps) rows.push([r.name, r.segment, ...questionOrder.map((q) => r.answers.get(q) ?? '')])
  return rows
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
  const rows: string[][] = [['Тип', 'Категория', 'Формулировки участников', 'Идеи контента']]
  for (const p of parsed) rows.push([MEANING_TYPE_RU[p.type] ?? p.type, p.cat, p.words, p.idea])
  return rows
}
