// Единая раскладка текста для дизайнера сторис/каруселей — «что двигаешь, то
// и экспортируешь». Чистый модуль: без DOM и без node-импортов, его зовут и
// превью в браузере, и серверный движок (lib/carousel/engine.tsx).
//
// Инцидент 06.09 (Марина): «нажимаешь «сохранить картинку» — слайд меняется,
// не сохраняется так, как я его сделала». Причина класса: превью переносило
// строки браузером по реальным глифам, а сервер — эвристикой «0,62·размер на
// символ» (wrapWords). Теперь строки считает ОДИН алгоритм по реальным ширинам
// (клиент меряет canvas.measureText тем же TTF, что грузит сервер), а сервер
// получает готовые строки и НЕ переносит заново.
//
// Разметка внутри текста (кнопки редактора ставят её сами):
//   **слово**  — акцентный цвет (как раньше),
//   __слово__  — жирным только это слово,
//   *слово*    — курсивом только это слово.

export interface RunStyle { em: boolean; bold: boolean; italic: boolean }
export interface Run extends RunStyle { text: string }
export interface LayoutLine { blank?: boolean; runs: Run[] }

// glue: слово приклеено к предыдущему без пробела — знак препинания сразу после
// маркера («**рублей**.») или слово, начатое внутри другого стиля без пробела.
type Tok = { word: string; style: RunStyle; glue?: boolean } | { br: true; blank: boolean }

const isBr = (t: Tok): t is { br: true; blank: boolean } => 'br' in t

/** Разбить текст на слова со стилями и переводы строк (как tokenize в движке, плюс __b__ и *i*). */
export function tokenizeStyled(text: string): Tok[] {
  const out: Tok[] = []
  // [[...]] — маркеры плашки (их разбирает parsePlateSegments) — здесь снимаем.
  const src = text.replace(/\[\[|\]\]/g, '')
  // Сегменты по маркерам: ** (акцент) → __ (жирный) → * (курсив).
  const segs = src.split(/(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*)/g).filter(Boolean)
  let prevEndsTight = false // предыдущий сегмент кончился НЕ пробелом → следующее слово клеится
  for (const seg of segs) {
    const em = seg.startsWith('**') && seg.endsWith('**') && seg.length > 4
    const bold = !em && seg.startsWith('__') && seg.endsWith('__') && seg.length > 4
    const italic = !em && !bold && seg.startsWith('*') && seg.endsWith('*') && seg.length > 2
    const raw = em || bold ? seg.slice(2, -2) : italic ? seg.slice(1, -1) : seg
    const startsTight = !/^\s/.test(raw)
    raw.split('\n').forEach((line, li) => {
      if (li > 0) { out.push({ br: true, blank: line.trim() === '' }); prevEndsTight = false }
      let first = true
      for (const w of line.split(/\s+/)) {
        if (!w) continue
        const glue = first && li === 0 && startsTight && prevEndsTight && out.length > 0 && !isBr(out[out.length - 1])
        out.push({ word: w, style: { em, bold, italic }, ...(glue ? { glue: true } : {}) })
        first = false
      }
    })
    prevEndsTight = !/\s$/.test(raw) && raw.length > 0
  }
  return out
}

/** Ширина строки в px в данном стиле — клиент меряет canvas, сервер — эвристикой. */
export type Measure = (text: string, style: RunStyle) => number

const sameStyle = (a: RunStyle, b: RunStyle) => a.em === b.em && a.bold === b.bold && a.italic === b.italic

type WordTok = { word: string; style: RunStyle; glue?: boolean }

function lineWidth(words: WordTok[], measure: Measure): number {
  let w = 0
  for (let i = 0; i < words.length; i++) {
    w += measure(words[i].word, words[i].style)
    if (i < words.length - 1 && !words[i + 1].glue) w += measure(' ', words[i].style)
  }
  return w
}

function wrapOnce(tokens: Tok[], maxWidth: number, measure: Measure): { lines: WordTok[][]; blankAt: Set<number> } {
  const lines: WordTok[][] = [[]]
  const blankAt = new Set<number>()
  for (const t of tokens) {
    if (isBr(t)) { if (t.blank) blankAt.add(lines.length); lines.push([]); continue }
    const cur = lines[lines.length - 1]
    // Приклеенный знак («рублей**.») не отрывается от слова: переносим вместе.
    if (t.glue && cur.length > 0 && lineWidth([...cur, t], measure) > maxWidth) {
      const prev = cur.pop()!
      lines.push([prev, t])
      continue
    }
    if (cur.length > 0 && lineWidth([...cur, t], measure) > maxWidth) lines.push([t])
    else cur.push(t)
  }
  return { lines, blankAt }
}

const hasWidow = (lines: WordTok[][]) => lines.length > 1 && lines[lines.length - 1].length === 1

/**
 * Перенос слов по реальным ширинам + правило «одно слово на последней строке —
 * чтоб такого не было» (то же, что в движке). Пустые строки текста остаются
 * абзацными зазорами (не в начале/конце, не подряд).
 */
export function wrapStyled(text: string, maxWidth: number, measure: Measure): LayoutLine[] {
  const tokens = tokenizeStyled(text.trim())
  let { lines, blankAt } = wrapOnce(tokens, maxWidth, measure)
  for (let shrink = 0.04; hasWidow(lines) && shrink <= 0.2; shrink += 0.04) {
    const retry = wrapOnce(tokens, maxWidth * (1 - shrink), measure)
    if (!hasWidow(retry.lines)) { lines = retry.lines; blankAt = retry.blankAt; break }
  }
  // Последняя попытка: стянуть слово с предыдущей строки вниз — но только если
  // новая последняя строка ВЛЕЗАЕТ по ширине (строки уходят на сервер как есть,
  // без повторного переноса; перелив за край недопустим).
  if (hasWidow(lines)) {
    const prev = lines[lines.length - 2], last = lines[lines.length - 1]
    if (prev.length >= 2) {
      const cand = [prev[prev.length - 1], ...last]
      if (lineWidth(cand, measure) <= maxWidth) { prev.pop(); lines[lines.length - 1] = cand }
    }
  }
  // Пустые строки только там, где были в тексте; без краевых и дублей.
  const kept: LayoutLine[] = []
  lines.forEach((l, i) => {
    if (l.length > 0) { kept.push({ runs: toRuns(l) }); return }
    if (blankAt.has(i) && kept.length > 0 && !kept[kept.length - 1].blank) kept.push({ blank: true, runs: [] })
  })
  while (kept.length && kept[kept.length - 1].blank) kept.pop()
  return kept
}

/** Слова строки → пробеги одного стиля с настоящими пробелами внутри. */
function toRuns(words: WordTok[]): Run[] {
  const runs: Run[] = []
  words.forEach((w, i) => {
    const last = runs[runs.length - 1]
    const sep = i === 0 || w.glue ? '' : ' '
    if (last && sameStyle(last, w.style)) last.text += sep + w.word
    else {
      // Пробел между разными стилями остаётся в предыдущем пробеге — так
      // ширина строки складывается из тех же кусков, что измерялись.
      if (last && sep) last.text += sep
      runs.push({ text: w.word, ...w.style })
    }
  })
  return runs
}

/** Геометрия текстового блока — одна на превью и экспорт (в px холста 1080). */
export function textMetrics(size: number) {
  return {
    padX: Math.round(size * 0.26),
    padY: Math.round(size * 0.14),
    radius: Math.round(size * 0.14),
    plateLineHeight: 1.15,
    plainLineHeight: 1.18,
    plainGap: 6,
    blankPlate: Math.round(size * 1.15),
    blankPlain: Math.round(size * 1.18),
    paraGap: Math.round(size * 0.22),
  }
}

/** Ширина для переноса: плашка забирает горизонтальные поля. */
export function wrapWidthFor(blockW: number, size: number, plate: boolean): number {
  return Math.max(24, plate ? blockW - textMetrics(size).padX * 2 : blockW)
}

/** Серверная эвристика для старых слайдов без готовых строк (как wrapWords раньше). */
export function heuristicMeasure(size: number): Measure {
  return (text) => text.length * size * 0.62
}

/** Текст → строки для клиента/сервера: заглавные применяются ДО переноса. */
export function layoutText(text: string, opts: { maxWidth: number; measure: Measure; uppercase?: boolean }): LayoutLine[] {
  const t = opts.uppercase ? text.toUpperCase() : text
  return wrapStyled(t, opts.maxWidth, opts.measure)
}
