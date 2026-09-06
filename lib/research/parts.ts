// Подготовка расшифровок к «Таблице исследования»: дубли, обрывки, план батчей.
// Чистые функции — их гоняет tests/smoke/research-table-job.test.ts.

export type Part = { name: string; text: string }

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

// Дубли расшифровок (Стася 04–05.09: одна запись залита четыре раза, «Дина» —
// дважды с разницей в 40 знаков от повторной расшифровки) → участник попадает
// в таблицу дважды. Точный дубль — по нормализованному тексту; «почти дубль» —
// та же запись, расшифрованная повторно: совпадает начало и длина в пределах 3%.
export function dedupeParts(parts: Part[]): { parts: Part[]; dropped: number } {
  const kept: { n: string; head: string; len: number; part: Part }[] = []
  let dropped = 0
  for (const p of parts) {
    const n = norm(p.text)
    if (!n) { dropped++; continue }
    const head = n.slice(0, 200)
    const dup = kept.some(k =>
      k.n === n || (k.head === head && Math.abs(k.len - n.length) / Math.max(k.len, n.length) < 0.03))
    if (dup) { dropped++; continue }
    kept.push({ n, head, len: n.length, part: p })
  }
  return { parts: kept.map(k => k.part), dropped }
}

// Минимум букв, ради которого стоит звать модель: пустая запись даёт «you»
// (4 знака) — такой батч только сжигает деньги и время.
export const MIN_PART_LETTERS = 40
export function isUsablePart(p: Part): boolean {
  return (p.text.match(/\p{L}/gu) ?? []).length >= MIN_PART_LETTERS
}

// План батчей: до maxParts расшифровок и maxChars знаков на один вызов. Ответ
// модели растёт вместе со входом (замер 04.09: 45 тыс. знаков на входе →
// 8,7 тыс. токенов ответа → 124 с), а батч обязан укладываться в одну ногу
// серверной функции с запасом — иначе инвокация умирает молча.
export const BATCH_MAX_PARTS = 3
export const BATCH_MAX_CHARS = 40_000
export function planBatches(parts: Part[], opts: { maxParts?: number; maxChars?: number } = {}): Part[][] {
  const maxParts = opts.maxParts ?? BATCH_MAX_PARTS
  const maxChars = opts.maxChars ?? BATCH_MAX_CHARS
  const batches: Part[][] = []
  let cur: Part[] = []
  let curChars = 0
  for (const p of parts) {
    const len = p.text.length
    if (cur.length > 0 && (cur.length >= maxParts || curChars + len > maxChars)) {
      batches.push(cur); cur = []; curChars = 0
    }
    cur.push(p); curChars += len
  }
  if (cur.length) batches.push(cur)
  return batches
}
