import { ImageResponse } from 'next/og'
import { createClient } from '@/lib/supabase/server'
import {
  loadFonts,
  planSlides,
  renderSlide,
  themeFromBrand,
  FORMATS,
  type BrandInput,
  type FormatKey,
  type SlideSpec,
} from '@/lib/carousel/engine'

// Renders ONE slide (carousel/post/story) to PNG. The client requests slides
// individually so previews stream in and the set can be zipped client-side.
// Node runtime so we can read font files from disk via readFile.
export const runtime = 'nodejs'
export const maxDuration = 60

type Dict = Record<string, unknown>

function paperUrlFrom(request: Request) {
  return new URL(request.url).origin + '/textures/paper.png'
}

async function png(spec: SlideSpec, format: FormatKey, brand: BrandInput) {
  const theme = themeFromBrand(brand)
  const fonts = await loadFonts()
  const size = FORMATS[format] ?? FORMATS.carousel
  return new ImageResponse(renderSlide(spec, theme, size), {
    width: size.w,
    height: size.h,
    fonts,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

export async function POST(request: Request) {
  try {
    // Auth: render burns server compute per call — app surfaces are all
    // authenticated, so an open endpoint was just a free render API.
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } })

    const body = (await request.json()) as Dict
    const format = (body.format as FormatKey) || 'carousel'
    const brand: BrandInput = { ...(body.brand as BrandInput), paperUrl: paperUrlFrom(request) }
    const index = Number(body.index ?? 0)

    let spec: SlideSpec
    if (body.slide) {
      // caller passes a ready slide spec (posts / stories)
      spec = { index: 0, total: 1, ...(body.slide as Partial<SlideSpec>) } as SlideSpec
    } else {
      const specs = planSlides((body.carousel ?? body) as Dict)
      if (specs.length === 0) return new Response('No slides', { status: 400 })
      spec = specs[Math.max(0, Math.min(index, specs.length - 1))]
      // Per-slide photo backgrounds for carousels: { "<slideIndex>": url }
      const photos = body.photos as Record<string, string> | undefined
      const ph = photos?.[String(index)]
      if (ph) spec = { ...spec, photoUrl: ph }
    }
    return png(spec, format, brand)
  } catch (e) {
    console.error('[carousel/render]', e instanceof Error ? e.message : e)
    return new Response('Failed to render slide', { status: 500 })
  }
}

// GET ?demo=1&format=carousel|post|story&i=N — quick eyeball without data.
export async function GET(request: Request) {
  // Eyeball-check endpoint — dev only (in prod it would be a free render API).
  if (process.env.NODE_ENV === 'production') return new Response('Not found', { status: 404 })
  const url = new URL(request.url)
  if (url.searchParams.get('demo') == null) return new Response('POST a carousel to render', { status: 400 })
  const format = (url.searchParams.get('format') as FormatKey) || 'carousel'
  const i = Number(url.searchParams.get('i') ?? 0)
  const brand: BrandInput = { handle: '@ama', paperUrl: paperUrlFrom(request) }

  try {
    if (format === 'post') {
      const spec: SlideSpec = { kind: 'post', index: 0, total: 1, emoji: '🚀', headline: '5 ошибок в **запусках** микро-блога', body: 'сохрани, чтобы не потерять' }
      return png(spec, 'post', brand)
    }
    if (format === 'story') {
      // Dev eyeball params: &photo=<url> renders the over-photo path,
      // &pos=top|center|bottom layout, &plate=0 clean text, &tc=ffffff its colour,
      // &hl=/&bd= override headline/body (use [[...]] to test selective plating).
      const photo = url.searchParams.get('photo') || undefined
      const pos = (url.searchParams.get('pos') as SlideSpec['position']) || undefined
      const plate = url.searchParams.get('plate') === '0' ? false : undefined
      const tc = url.searchParams.get('tc') ? `#${url.searchParams.get('tc')}` : undefined
      const transparent = url.searchParams.get('transparent') === '1' || undefined
      const hl = url.searchParams.get('hl') || undefined
      const bd = url.searchParams.get('bd') || undefined
      const spec: SlideSpec = { kind: 'story', index: 0, total: 1, headline: hl ?? 'как я набрала **первую 1000** подписчиков', body: bd ?? 'рассказываю по шагам в следующих сторис', action: 'смотри до конца', photoUrl: photo, position: pos, plate, textColor: tc, transparent }
      return png(spec, 'story', brand)
    }
    if (url.searchParams.get('format') === 'free') {
      const spec: SlideSpec = {
        kind: 'free', index: 0, total: 1, photoUrl: url.searchParams.get('photo') || undefined,
        blocks: [
          { text: 'Снимаю **плёночку** с нового айфона', xPct: 0.06, yPct: 0.10, widthPct: 0.82, size: 58, color: '#FFFFFF', plate: true, align: 'left' },
          { text: 'а вы себя **радуете**?', xPct: 0.10, yPct: 0.72, widthPct: 0.66, size: 52, plate: true, align: 'left' },
        ],
      }
      return png(spec, 'story', brand)
    }
    if (url.searchParams.get('format') === 'scheme') {
      const spec: SlideSpec = {
        kind: 'scheme', index: 0, total: 1,
        headline: 'а я ей всё разложила по полочкам, показала все пробелы — ей всё понравилось',
        steps: ['исследование её **ЦА**', 'упаковка в **смыслы**', '**воронки**', 'её личный **продукт**'],
      }
      return png(spec, 'story', brand)
    }
    const demo: Dict = {
      total_slides: 5,
      cover: { headline: 'где брать **клиентов**?', subheadline: 'если таргет не работает, а рекламу у блогеров отменили', emoji: '🤔' },
      slides: [
        { headline: 'подписчики **=** продажи', body: 'чтобы продажи росли, аудитория микро-блога должна **обновляться**. сейчас есть несколько способов получить трафик.' },
        { emoji: '🔥', headline: 'способ 1 — **паблики**', body: 'публикуемся в пабликах по вашей теме. на прошлой неделе так привели **200 подписчиков**, 20 из них купили.' },
        { headline: 'способ 2 — **взаимопиар**', body: 'находим блогеров с похожей аудиторией и **обмениваемся** рекомендациями. бесплатно и работает.' },
      ],
      last_slide: { text: 'хочешь свою **персональную воронку** трафика?', action: 'пиши «хочу трафик» мне в директ' },
    }
    const specs = planSlides(demo)
    let spec = specs[Math.max(0, Math.min(i, specs.length - 1))]
    // Dev eyeball: &photo= puts the creator photo behind a carousel slide too
    const cPhoto = url.searchParams.get('photo')
    if (cPhoto) spec = { ...spec, photoUrl: cPhoto }
    return png(spec, 'carousel', brand)
  } catch (e) {
    console.error('[carousel/render demo]', e instanceof Error ? e.message : e)
    return new Response('Failed to render demo slide', { status: 500 })
  }
}
