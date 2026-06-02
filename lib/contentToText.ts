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
    if (s(reels.title)) out.push(s(reels.title))
    if (s(reels.hook_text)) out.push(`Хук: ${s(reels.hook_text)}`)
    arr(reels.scenes).forEach((sc, i) => {
      const audio = sc.audio as Dict | undefined
      const visual = sc.visual as Dict | undefined
      out.push(`\nСцена ${s(sc.scene) || i + 1}${sc.timing ? ` (${s(sc.timing)})` : ''}:`)
      if (s(sc.text_overlay)) out.push(`Текст на экране: ${s(sc.text_overlay)}`)
      if (audio && s(audio.speech)) out.push(`Озвучка: ${s(audio.speech)}`)
      if (visual && s(visual.action)) out.push(`Действие: ${s(visual.action)}`)
    })
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
    if (cover && s(cover.headline)) out.push(`Обложка: ${s(cover.headline)}`)
    arr(carousel.slides).forEach((sl, i) => {
      out.push(`Слайд ${s(sl.slide) || i + 2}: ${s(sl.headline)}${sl.body ? ` — ${s(sl.body)}` : ''}`)
    })
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

  return ''
}
