// Flatten a content item (plain post text OR structured reels/stories/carousel/
// email/live JSON) into readable plain text — used when saving to the library.

type Dict = Record<string, unknown>
const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const arr = (v: unknown): Dict[] => (Array.isArray(v) ? (v as Dict[]) : [])

export function contentItemToText(item: {
  body_text?: string | null
  structured_data?: unknown
}): string {
  if (item.body_text && item.body_text.trim()) return item.body_text.trim()
  const sd = item.structured_data as Dict | null | undefined
  if (!sd) return ''
  const out: string[] = []

  const reels = sd.reels as Dict | undefined
  if (reels) {
    if (s(reels.title)) out.push(s(reels.title), '')
    if (s(reels.hook_text)) out.push(`Хук: ${s(reels.hook_text)}`)
    if (s(reels.total_duration)) out.push(`Длительность: ${s(reels.total_duration)}`)
    arr(reels.scenes).forEach((sc, i) => {
      const audio = sc.audio as Dict | undefined
      const visual = sc.visual as Dict | undefined
      out.push(`\nСцена ${s(sc.scene) || i + 1}${sc.timing ? ` (${s(sc.timing)})` : ''}:`)
      if (s(sc.text_overlay)) out.push(`Текст на экране: ${s(sc.text_overlay)}`)
      if (audio && s(audio.speech)) out.push(`Озвучка: ${s(audio.speech)}`)
      if (visual && s(visual.action)) out.push(`Действие: ${s(visual.action)}`)
    })
    if (s(reels.description_text)) out.push(`\nОписание под видео:\n${s(reels.description_text)}`)
    return out.join('\n').trim()
  }

  const stories = (sd.stories_series ?? sd.stories) as Dict | undefined
  if (stories) {
    arr(stories.stories).forEach((st, i) => {
      const text = st.text as Dict | undefined
      out.push(`Сторис ${s(st.story_number) || i + 1}:`)
      if (text && s(text.headline)) out.push(s(text.headline))
      if (text && s(text.subtext)) out.push(s(text.subtext))
      if (s(st.voiceover)) out.push(`Голос: ${s(st.voiceover)}`)
      out.push('')
    })
    return out.join('\n').trim()
  }

  const carousel = sd.carousel as Dict | undefined
  if (carousel) {
    const cover = carousel.cover as Dict | undefined
    if (cover) {
      out.push('Обложка:')
      if (s(cover.headline)) out.push(s(cover.headline))
      if (s(cover.subheadline)) out.push(s(cover.subheadline))
      out.push('')
    }
    arr(carousel.slides).forEach((sl, i) => {
      out.push(`Слайд ${s(sl.slide) || i + 2}:`)
      if (s(sl.headline)) out.push(s(sl.headline))
      if (s(sl.body)) out.push(s(sl.body))
      out.push('')
    })
    const lastSlide = carousel.last_slide as Dict | undefined
    if (lastSlide) {
      out.push('Финальный слайд:')
      if (s(lastSlide.text)) out.push(s(lastSlide.text))
      if (s(lastSlide.action)) out.push(s(lastSlide.action))
    }
    return out.join('\n').trim()
  }

  const email = sd.email as Dict | undefined
  if (email) {
    if (s(email.subject)) out.push(`Тема: ${s(email.subject)}`)
    if (s(email.body)) out.push(s(email.body))
    return out.join('\n').trim()
  }

  const live = sd.live as Dict | undefined
  if (live) {
    if (s(live.title)) out.push(s(live.title))
    arr(live.structure).forEach(b => out.push(`${s(b.block)}: ${s(b.content)}`))
    return out.join('\n').trim()
  }

  // Unknown structured shape — still flatten it readably (never return JSON).
  return objectToReadableText(sd)
}

// Recursively flatten ANY object/array into readable labeled text — no braces,
// quotes or escaped \n. Used as the last-resort renderer so the user never sees
// raw JSON for a shape we don't have a dedicated layout for.
export function objectToReadableText(value: unknown, depth = 0): string {
  const lines: string[] = []
  const walk = (v: unknown, d: number) => {
    const pad = '  '.repeat(d)
    if (v == null || v === '') return
    if (typeof v !== 'object') { lines.push(`${pad}${String(v)}`); return }
    if (Array.isArray(v)) { v.forEach(x => walk(x, d)); return }
    for (const [k, val] of Object.entries(v as Dict)) {
      if (val == null || val === '') continue
      const label = k.replace(/_/g, ' ')
      if (typeof val === 'object') { lines.push(`${pad}${label}:`); walk(val, d + 1) }
      else lines.push(`${pad}${label}: ${String(val)}`)
    }
  }
  walk(value, depth)
  return lines.join('\n').trim()
}

// If `text` is a JSON content blob (the model occasionally returns one in chat),
// render it as readable text; otherwise return the text unchanged.
export function jsonBlobToText(text: string): string {
  const t = text.trim()
  if (!t.startsWith('{') || !t.endsWith('}')) return text
  let obj: unknown
  try { obj = JSON.parse(t) } catch { return text }
  const known = contentItemToText({ structured_data: obj })
  if (known.trim()) return known
  const flat = objectToReadableText(obj)
  return flat || text
}
