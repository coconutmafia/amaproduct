// Ядро авто-монтажа рилса: чистые функции без I/O — режутся паузы, слова
// раскладываются в фразы субтитров, собирается ffmpeg-граф. Всё, что можно
// проверить тестами без ffmpeg, живёт здесь; сам прогон — в runMontageJob.
//
// Дизайн-рамки MVP (решение 21 июля):
//   • только готовые бесплатные кирпичи: ffmpeg-static (уже на сервере) +
//     Whisper с таймкодами слов (уже платим OpenAI). Никаких новых сервисов.
//   • видео ≤ ~90 сек и ≤ 60 МБ — влезает в лимит серверной функции (300с);
//   • субтитры и хук жжём ОДНИМ фильтром `subtitles` (ASS/libass) со шрифтами
//     из public/fonts через fontsdir. ⚠️ drawtext в ffmpeg-static НЕ СОБРАН
//     (проверено живым прогоном: «No such filter: drawtext») — не переписывай
//     на drawtext, сломается на сервере. `subtitles` в сборке есть, а libass
//     ещё и сам переносит длинные строки.

export interface Interval { start: number; end: number }
export interface Word { word: string; start: number; end: number }
export interface Phrase { text: string; start: number; end: number }

// ── 1. Паузы ────────────────────────────────────────────────────────────────

// Разбор stderr ffmpeg silencedetect: строки вида
//   [silencedetect @ 0x...] silence_start: 12.34
//   [silencedetect @ 0x...] silence_end: 14.56 | silence_duration: 2.22
export function parseSilences(stderr: string): Interval[] {
  const out: Interval[] = []
  let start: number | null = null
  for (const line of stderr.split('\n')) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/)
    if (s) { start = Number(s[1]); continue }
    const e = line.match(/silence_end:\s*(-?[\d.]+)/)
    if (e && start !== null) {
      out.push({ start: Math.max(0, start), end: Number(e[1]) })
      start = null
    }
  }
  return out
}

// Паузы → сегменты, которые ОСТАВЛЯЕМ. Правила:
//   • режем только паузы длиннее minSilence (короткие вдохи — это естественный ритм);
//   • по краям выреза оставляем pad секунд, чтобы речь не обрубалась;
//   • сегменты короче minSegment склеиваются с соседями (мельтешение хуже паузы).
export function buildKeepSegments(
  silences: Interval[],
  duration: number,
  opts: { minSilence?: number; pad?: number; minSegment?: number } = {},
): Interval[] {
  const { minSilence = 0.8, pad = 0.18, minSegment = 0.5 } = opts
  const cuts = silences
    .filter((s) => s.end - s.start >= minSilence)
    .map((s) => ({ start: s.start + pad, end: s.end - pad }))
    .filter((s) => s.end > s.start)

  const keep: Interval[] = []
  let cursor = 0
  for (const c of cuts) {
    if (c.start > cursor) keep.push({ start: cursor, end: Math.min(c.start, duration) })
    cursor = Math.max(cursor, c.end)
  }
  if (cursor < duration) keep.push({ start: cursor, end: duration })

  // склейка коротышей с предыдущим сегментом
  const merged: Interval[] = []
  for (const seg of keep) {
    const prev = merged[merged.length - 1]
    if (prev && seg.end - seg.start < minSegment) prev.end = seg.end
    else if (prev && seg.start - prev.end < 0.01 + 2 * 0.2 && seg.end - seg.start < minSegment) prev.end = seg.end
    else merged.push({ ...seg })
  }
  return merged.filter((s) => s.end - s.start >= 0.1)
}

// ── 2. Ремап таймкодов ──────────────────────────────────────────────────────

// Слова Whisper живут в таймлайне ИСХОДНИКА; после вырезания пауз таймлайн
// сжимается. Переносим отметку времени в новый таймлайн (null = слово попало
// в вырезанную паузу — в субтитры не идёт).
export function remapTime(t: number, keep: Interval[]): number | null {
  let offset = 0
  for (const seg of keep) {
    if (t < seg.start) return null
    if (t <= seg.end) return offset + (t - seg.start)
    offset += seg.end - seg.start
  }
  return null
}

export function totalDuration(keep: Interval[]): number {
  return keep.reduce((s, k) => s + (k.end - k.start), 0)
}

// ── 3. Фразы субтитров ──────────────────────────────────────────────────────

// Слова → короткие фразы «как у блогеров»: 2-4 слова на экране, смена по
// паузам в речи. Тайминги уже в НОВОМ таймлайне.
export function wordsToPhrases(
  words: Word[],
  keep: Interval[],
  opts: { maxWords?: number; maxGap?: number; maxChars?: number } = {},
): Phrase[] {
  const { maxWords = 4, maxGap = 0.6, maxChars = 24 } = opts
  const mapped = words
    .map((w) => {
      const start = remapTime(w.start, keep)
      const end = remapTime(w.end, keep) ?? (start !== null ? start + 0.3 : null)
      return start === null || end === null ? null : { word: w.word.trim(), start, end }
    })
    .filter((w): w is Word => w !== null && w.word.length > 0)

  const phrases: Phrase[] = []
  let cur: Word[] = []
  const flush = () => {
    if (!cur.length) return
    phrases.push({
      text: cur.map((w) => w.word).join(' '),
      start: cur[0].start,
      end: cur[cur.length - 1].end + 0.12,
    })
    cur = []
  }
  for (const w of mapped) {
    const prev = cur[cur.length - 1]
    const curLen = cur.reduce((s, x) => s + x.word.length + 1, 0)
    // drawtext не переносит строки — фраза обязана влезать в кадр одной строкой
    if (prev && (w.start - prev.end > maxGap || cur.length >= maxWords || curLen + w.word.length > maxChars)) flush()
    cur.push(w)
  }
  flush()
  // фразы не должны перекрываться — конец фразы не позже начала следующей
  for (let i = 0; i < phrases.length - 1; i++) {
    if (phrases[i].end > phrases[i + 1].start) phrases[i].end = phrases[i + 1].start
  }
  return phrases
}

// ── 4. ASS-субтитры ─────────────────────────────────────────────────────────

// Текст события ASS: фигурные скобки — служебные override-теги, вычищаем;
// переводы строк — \N.
export function escapeAss(text: string): string {
  return text.replace(/[{}]/g, '').replace(/\r?\n/g, '\\N').trim()
}

// Секунды → формат времени ASS (h:mm:ss.cc)
export function assTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  const c = cs % 100
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`
}

// Один .ass на всё: стиль Sub (низ, фразы по словам) + стиль Hook (верх,
// крупнее, первые секунды). libass сам переносит длинные строки (PlayRes 1080).
export function buildAss(phrases: Phrase[], hookText?: string, hookUntil = 2.8): string {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,Montserrat,64,&H00FFFFFF,&H00FFFFFF,&H26000000,&H7F000000,-1,0,0,0,100,100,0,0,1,5,1,2,60,60,420,1
Style: Hook,Montserrat,76,&H00FFFFFF,&H00FFFFFF,&H26000000,&H7F000000,-1,0,0,0,100,100,0,0,1,6,1,8,60,60,240,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
  const lines: string[] = []
  if (hookText?.trim()) {
    lines.push(`Dialogue: 1,${assTime(0)},${assTime(hookUntil)},Hook,,0,0,0,,${escapeAss(hookText.slice(0, 90))}`)
  }
  for (const p of phrases) {
    if (p.end <= p.start) continue
    lines.push(`Dialogue: 0,${assTime(p.start)},${assTime(p.end)},Sub,,0,0,0,,${escapeAss(p.text)}`)
  }
  return header + lines.join('\n') + '\n'
}

// ── 5. ffmpeg-граф ──────────────────────────────────────────────────────────

const num = (n: number) => (Math.round(n * 1000) / 1000).toFixed(3)

// Экранирование пути для аргумента фильтра subtitles (':' и '\' в пути).
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

// Полный filter_complex: вырезание пауз (trim+concat) → 9:16 кадр → один
// фильтр subtitles с нашим .ass (фразы + хук). Возвращает граф и имена выходов.
export function buildFilterGraph(opts: {
  keep: Interval[]
  hasSubtitles: boolean
  assPath?: string
  fontsDir?: string
}): { filter: string; videoOut: string; audioOut: string } {
  const { keep, hasSubtitles, assPath, fontsDir } = opts
  const parts: string[] = []

  // 5.1 вырезание пауз
  keep.forEach((seg, i) => {
    parts.push(`[0:v]trim=start=${num(seg.start)}:end=${num(seg.end)},setpts=PTS-STARTPTS[v${i}]`)
    parts.push(`[0:a]atrim=start=${num(seg.start)}:end=${num(seg.end)},asetpts=PTS-STARTPTS[a${i}]`)
  })
  const concatIn = keep.map((_, i) => `[v${i}][a${i}]`).join('')
  parts.push(`${concatIn}concat=n=${keep.length}:v=1:a=1[vc][ac]`)

  // 5.2 нормализация в 1080×1920 (как в video/overlay — проверено в проде)
  let v = 'vs'
  parts.push(`[vc]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[vs]`)

  // 5.3 субтитры + хук одним фильтром
  if (hasSubtitles && assPath) {
    const fonts = fontsDir ? `:fontsdir='${escapeFilterPath(fontsDir)}'` : ''
    parts.push(`[${v}]subtitles='${escapeFilterPath(assPath)}'${fonts}[vsub]`)
    v = 'vsub'
  }

  return { filter: parts.join(';'), videoOut: `[${v}]`, audioOut: '[ac]' }
}
