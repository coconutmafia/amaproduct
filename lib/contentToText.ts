// Flatten a content item (plain post text OR structured reels/stories/carousel/
// email/live JSON) into readable plain text — used when saving to the library.

type Dict = Record<string, unknown>
const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const arr = (v: unknown): Dict[] => (Array.isArray(v) ? (v as Dict[]) : [])

// Метки-заголовки («Сцена», «Озвучка») подбираются под язык САМОГО контента:
// англоязычный рилз не должен читаться «Сцена 1 / Озвучка: ...». Язык
// определяется по строковым ЗНАЧЕНИЯМ (ключи JSON латинские всегда и не в счёт).
// Локальный хелпер, не импорт из prompts/content-brain — эта либа попадает в
// клиентский бандл, тянуть туда весь модуль промптов нельзя.
const L10N = {
  ru: {
    hook: 'Хук', duration: 'Длительность', scene: 'Сцена', overlay: 'Текст на экране',
    voiceover: 'Озвучка', action: 'Действие', description: 'Описание под видео',
    story: 'Сторис', voice: 'Голос', cover: 'Обложка', slide: 'Слайд',
    lastSlide: 'Финальный слайд', subject: 'Тема',
  },
  en: {
    hook: 'Hook', duration: 'Duration', scene: 'Scene', overlay: 'On-screen text',
    voiceover: 'Voiceover', action: 'Action', description: 'Caption',
    story: 'Story', voice: 'Voice', cover: 'Cover', slide: 'Slide',
    lastSlide: 'Final slide', subject: 'Subject',
  },
  es: {
    hook: 'Gancho', duration: 'Duración', scene: 'Escena', overlay: 'Texto en pantalla',
    voiceover: 'Voz en off', action: 'Acción', description: 'Descripción del vídeo',
    story: 'Historia', voice: 'Voz', cover: 'Portada', slide: 'Diapositiva',
    lastSlide: 'Última diapositiva', subject: 'Asunto',
  },
  de: {
    hook: 'Hook', duration: 'Dauer', scene: 'Szene', overlay: 'Text im Bild',
    voiceover: 'Voiceover', action: 'Aktion', description: 'Videobeschreibung',
    story: 'Story', voice: 'Stimme', cover: 'Cover', slide: 'Slide',
    lastSlide: 'Letzter Slide', subject: 'Betreff',
  },
}

// Служебные enum-значения из JSON-схем ('cut', 'hook', 'poll'…) — латиница,
// но НЕ признак английского контента; в подсчёт языка не идут.
const ENUM_TOKENS = new Set(['cut', 'hook', 'poll', 'quiz', 'question', 'opener', 'cta', 'top', 'center', 'bottom', 'with', 'without', 'auto', 'post', 'reels', 'stories', 'carousel', 'email', 'live'])

function collectStringValues(v: unknown, acc: string[] = []): string[] {
  if (typeof v === 'string') { if (!ENUM_TOKENS.has(v.trim().toLowerCase())) acc.push(v) }
  else if (Array.isArray(v)) v.forEach(x => collectStringValues(x, acc))
  else if (v && typeof v === 'object') Object.values(v as Dict).forEach(x => collectStringValues(x, acc))
  return acc
}

function labelsFor(sd: Dict): typeof L10N.ru {
  const text = collectStringValues(sd).join(' ')
  const letters = (text.match(/[a-zA-Zа-яА-ЯёЁäöüßÄÖÜáéíóúüñÁÉÍÓÚÑ]/g) || []).length
  if (letters < 40) return L10N.ru
  const latin = (text.match(/[a-zA-ZäöüßÄÖÜáéíóúüñÁÉÍÓÚÑ]/g) || []).length
  if (latin / letters <= 0.6) return L10N.ru
  // Латиница ≠ английский: различаем en/es/de по символам и служебным словам
  // (та же логика, что detectTextLanguage в content-brain — локально, чтобы не
  // тянуть модуль промптов в клиентский бандл).
  if (/[¿¡]|ñ/i.test(text)) return L10N.es
  if (/ß/.test(text)) return L10N.de
  const words = text.toLowerCase().match(/[a-záéíóúüäöß]+/g) || []
  let esHits = 0, enHits = 0, deHits = 0
  const esStop = new Set(['que', 'de', 'la', 'el', 'los', 'las', 'una', 'para', 'como', 'está', 'pero', 'por', 'con', 'más', 'es', 'un', 'en', 'no', 'se', 'del', 'al', 'y'])
  const enStop = new Set(['the', 'and', 'you', 'that', 'this', 'for', 'with', 'was', 'are', 'have', 'not', 'but', 'what', 'your', 'from', 'they'])
  const deStop = new Set(['und', 'der', 'die', 'das', 'ich', 'nicht', 'mit', 'für', 'ist', 'auf', 'dass', 'ein', 'eine', 'wie', 'aber', 'dem', 'den', 'mir', 'mich', 'dir', 'du', 'wir', 'sich', 'auch'])
  for (const w of words) {
    if (esStop.has(w)) esHits++
    if (enStop.has(w)) enHits++
    if (deStop.has(w)) deHits++
  }
  if (deHits > enHits && deHits > esHits && deHits >= 3) return L10N.de
  if (esHits > enHits && esHits >= 3) return L10N.es
  return L10N.en
}

export function contentItemToText(item: {
  body_text?: string | null
  structured_data?: unknown
}): string {
  if (item.body_text && item.body_text.trim()) return item.body_text.trim()
  const sd = item.structured_data as Dict | null | undefined
  if (!sd) return ''
  const out: string[] = []
  const t = labelsFor(sd)

  const reels = sd.reels as Dict | undefined
  if (reels) {
    if (s(reels.title)) out.push(s(reels.title), '')
    if (s(reels.hook_text)) out.push(`${t.hook}: ${s(reels.hook_text)}`)
    if (s(reels.total_duration)) out.push(`${t.duration}: ${s(reels.total_duration)}`)
    arr(reels.scenes).forEach((sc, i) => {
      const audio = sc.audio as Dict | undefined
      const visual = sc.visual as Dict | undefined
      out.push(`\n${t.scene} ${s(sc.scene) || i + 1}${sc.timing ? ` (${s(sc.timing)})` : ''}:`)
      if (s(sc.text_overlay)) out.push(`${t.overlay}: ${s(sc.text_overlay)}`)
      if (audio && s(audio.speech)) out.push(`${t.voiceover}: ${s(audio.speech)}`)
      if (visual && s(visual.action)) out.push(`${t.action}: ${s(visual.action)}`)
    })
    if (s(reels.description_text)) out.push(`\n${t.description}:\n${s(reels.description_text)}`)
    return out.join('\n').trim()
  }

  const stories = (sd.stories_series ?? sd.stories) as Dict | undefined
  if (stories) {
    arr(stories.stories).forEach((st, i) => {
      const text = st.text as Dict | undefined
      out.push(`${t.story} ${s(st.story_number) || i + 1}:`)
      if (text && s(text.headline)) out.push(s(text.headline))
      if (text && s(text.subtext)) out.push(s(text.subtext))
      if (s(st.voiceover)) out.push(`${t.voice}: ${s(st.voiceover)}`)
      out.push('')
    })
    return out.join('\n').trim()
  }

  const carousel = sd.carousel as Dict | undefined
  if (carousel) {
    const cover = carousel.cover as Dict | undefined
    if (cover) {
      out.push(`${t.cover}:`)
      if (s(cover.headline)) out.push(s(cover.headline))
      if (s(cover.subheadline)) out.push(s(cover.subheadline))
      out.push('')
    }
    arr(carousel.slides).forEach((sl, i) => {
      out.push(`${t.slide} ${s(sl.slide) || i + 2}:`)
      if (s(sl.headline)) out.push(s(sl.headline))
      if (s(sl.body)) out.push(s(sl.body))
      out.push('')
    })
    const lastSlide = carousel.last_slide as Dict | undefined
    if (lastSlide) {
      out.push(`${t.lastSlide}:`)
      if (s(lastSlide.text)) out.push(s(lastSlide.text))
      if (s(lastSlide.action)) out.push(s(lastSlide.action))
    }
    return out.join('\n').trim()
  }

  const email = sd.email as Dict | undefined
  if (email) {
    if (s(email.subject)) out.push(`${t.subject}: ${s(email.subject)}`)
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
