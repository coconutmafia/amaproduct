/* eslint-disable @next/next/no-img-element */
// Brand-aware slide engine: renders carousels, posts and stories to PNG via
// next/og (Satori). Satori constraints: flexbox only (NO grid), a div with >1
// child MUST set display:flex, only ttf/otf/woff fonts, subset of CSS.
//
// Everything is parametrised by a CarouselTheme (the project's brand kit), so the
// same templates produce on-brand output for any creator: their colours, their
// font, their logo, their background style.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ReactElement } from 'react'

// ── Formats ─────────────────────────────────────────────────────────────────────
export const FORMATS = {
  carousel: { w: 1080, h: 1350 }, // 4:5
  post: { w: 1080, h: 1080 }, // 1:1
  post45: { w: 1080, h: 1350 }, // 4:5 single post (best for IG feed reach)
  story: { w: 1080, h: 1920 }, // 9:16
} as const
export type FormatKey = keyof typeof FORMATS
export type Size = { w: number; h: number }

// ── Theme (a project's brand kit, resolved to concrete values) ──────────────────
export type BgStyle = 'paper' | 'solid' | 'gradient'

export interface CarouselTheme {
  bg: string
  bgAlt: string
  bgStyle: BgStyle
  paperUrl?: string // absolute URL to the paper-grain texture (when bgStyle='paper')
  text: string
  textMuted: string
  accent: string
  gradFrom: string
  gradMid: string
  gradTo: string
  fontFamily: string
  handle: string
  logoUrl?: string
  onPhotoText: string // text colour used over photos/scrims
}

export const DEFAULT_THEME: CarouselTheme = {
  bg: '#F3EEE7',
  bgAlt: '#FBF8F3',
  bgStyle: 'paper',
  text: '#262321',
  textMuted: '#6E6862',
  accent: '#EC1E8C',
  gradFrom: '#F9A03F',
  gradMid: '#F86E80',
  gradTo: '#EC4899',
  fontFamily: 'Montserrat',
  handle: '',
  onPhotoText: '#262321',
}

export interface BrandInput {
  accentColor?: string | null
  bg?: string | null
  bgAlt?: string | null
  bgStyle?: BgStyle | null
  text?: string | null
  handle?: string | null
  logoUrl?: string | null
  paperUrl?: string | null
}

function hexLum(hex?: string): number {
  const h = (hex || '').replace('#', '')
  if (h.length < 6) return 1
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return 1
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}
function lighten(hex: string, amt: number): string {
  const h = hex.replace('#', '')
  if (h.length < 6) return hex
  const ch = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16)
    return Math.round(v + (255 - v) * amt).toString(16).padStart(2, '0')
  }
  return `#${ch(0)}${ch(2)}${ch(4)}`
}

export function themeFromBrand(brand?: BrandInput): CarouselTheme {
  const bg = brand?.bg?.trim() || DEFAULT_THEME.bg
  const dark = hexLum(bg) < 0.5 // dark brand → white text + light-on-dark muted
  return {
    ...DEFAULT_THEME,
    accent: brand?.accentColor?.trim() || DEFAULT_THEME.accent,
    bg,
    bgAlt: brand?.bgAlt?.trim() || (dark ? lighten(bg, 0.14) : DEFAULT_THEME.bgAlt),
    bgStyle: brand?.bgStyle || (dark ? 'solid' : DEFAULT_THEME.bgStyle),
    text: brand?.text?.trim() || (dark ? '#FFFFFF' : DEFAULT_THEME.text),
    textMuted: dark ? 'rgba(255,255,255,0.62)' : DEFAULT_THEME.textMuted,
    handle: (brand?.handle || '').trim(),
    logoUrl: brand?.logoUrl || undefined,
    paperUrl: brand?.paperUrl || undefined,
  }
}

// ── Fonts (read at request time → not subject to the edge bundle limit) ─────────
type FontDef = { name: string; data: Buffer; weight: number; style: 'normal' | 'italic' }
let fontCache: FontDef[] | null = null

export async function loadFonts(): Promise<FontDef[]> {
  if (fontCache) return fontCache
  const dir = join(process.cwd(), 'public/fonts')
  const load = (f: string) => readFile(join(dir, f))
  const [reg, med, bold, xbold, black, italic] = await Promise.all([
    load('Montserrat-Regular.ttf'),
    load('Montserrat-Medium.ttf'),
    load('Montserrat-Bold.ttf'),
    load('Montserrat-ExtraBold.ttf'),
    load('Montserrat-Black.ttf'),
    load('Montserrat-Italic.ttf'),
  ])
  fontCache = [
    { name: 'Montserrat', data: reg, weight: 400, style: 'normal' },
    { name: 'Montserrat', data: med, weight: 500, style: 'normal' },
    { name: 'Montserrat', data: bold, weight: 700, style: 'normal' },
    { name: 'Montserrat', data: xbold, weight: 800, style: 'normal' },
    { name: 'Montserrat', data: black, weight: 900, style: 'normal' },
    { name: 'Montserrat', data: italic, weight: 400, style: 'italic' },
  ]
  return fontCache
}

// ── Rich text: inline accent via **markers** (Satori has no inline spans, so we
//    tokenise into flex-wrap word chips and colour/weight the emphasised ones) ───
type RichOpts = {
  size: number
  weight?: number
  color: string
  accent: string
  align?: 'center' | 'left'
  lineGap?: number
  uppercase?: boolean
  accentWeight?: number
}

function tokenize(text: string): { word: string; em: boolean; br?: boolean }[] {
  const out: { word: string; em: boolean; br?: boolean }[] = []
  const segs = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  for (const seg of segs) {
    const em = seg.startsWith('**') && seg.endsWith('**')
    const raw = em ? seg.slice(2, -2) : seg
    raw.split('\n').forEach((line, li) => {
      if (li > 0) out.push({ word: '', em: false, br: true })
      for (const w of line.split(/\s+/)) {
        if (w) out.push({ word: w, em })
      }
    })
  }
  return out
}

export function RichText({ text, o }: { text: string; o: RichOpts }): ReactElement {
  const t = (o.uppercase ? text.toUpperCase() : text).trim()
  const items = tokenize(t)
  const gap = o.size * 0.26
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        width: '100%',
        justifyContent: o.align === 'left' ? 'flex-start' : 'center',
        alignItems: 'baseline',
        fontFamily: 'Montserrat',
        fontSize: o.size,
        lineHeight: 1.18,
      }}
    >
      {items.map((it, i) => {
        if (it.br) return <div key={i} style={{ display: 'flex', width: '100%', height: 0 }} />
        const punct = /^[.,!?;:»)]+$/.test(it.word)
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              color: it.em ? o.accent : o.color,
              fontSize: o.size,
              fontWeight: it.em ? o.accentWeight ?? 800 : o.weight ?? 500,
              marginRight: gap,
              marginLeft: punct ? -gap : 0,
              marginBottom: o.lineGap ?? o.size * 0.18,
            }}
          >
            {it.word}
          </div>
        )
      })}
    </div>
  )
}

// ── Background ──────────────────────────────────────────────────────────────────
function Backdrop({ theme, size }: { theme: CarouselTheme; size: Size }): ReactElement {
  const base =
    theme.bgStyle === 'gradient'
      ? { backgroundImage: `linear-gradient(155deg, ${theme.bg} 0%, ${theme.bgAlt} 100%)` }
      : { backgroundColor: theme.bg }
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: size.w, height: size.h, display: 'flex', ...base }}>
      {theme.bgStyle === 'paper' && theme.paperUrl ? (
        <img src={theme.paperUrl} width={size.w} height={size.h} style={{ objectFit: 'cover' }} alt="" />
      ) : (
        <div style={{ display: 'flex' }} />
      )}
    </div>
  )
}

function Footer({ theme, size, index, total }: { theme: CarouselTheme; size: Size; index: number; total: number }): ReactElement {
  const multi = total > 1
  const isLast = index === total - 1
  return (
    <div
      style={{
        position: 'absolute',
        bottom: Math.round(size.h * 0.04),
        left: 72,
        right: 72,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {theme.logoUrl ? <img src={theme.logoUrl} height={40} style={{ objectFit: 'contain' }} alt="" /> : <div style={{ display: 'flex' }} />}
        {theme.handle ? (
          <div style={{ display: 'flex', marginLeft: theme.logoUrl ? 14 : 0, color: theme.textMuted, fontSize: 22, fontWeight: 700, letterSpacing: 2 }}>
            {theme.handle.toUpperCase()}
          </div>
        ) : (
          <div style={{ display: 'flex' }} />
        )}
      </div>
      {multi ? (
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {!isLast && (
            <div style={{ display: 'flex', color: theme.accent, fontSize: 22, fontWeight: 800, letterSpacing: 3 }}>ЛИСТАЙ ДАЛЬШЕ →</div>
          )}
          <div style={{ display: 'flex', marginLeft: 18, color: theme.textMuted, fontSize: 22, fontWeight: 800 }}>
            {String(index + 1).padStart(2, '0')}/{String(total).padStart(2, '0')}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex' }} />
      )}
    </div>
  )
}

function Frame({
  theme,
  size,
  index,
  total,
  children,
  justify = 'center',
}: {
  theme: CarouselTheme
  size: Size
  index: number
  total: number
  children: ReactElement | ReactElement[]
  justify?: 'center' | 'flex-start'
}): ReactElement {
  return (
    <div style={{ display: 'flex', position: 'relative', width: size.w, height: size.h }}>
      <Backdrop theme={theme} size={size} />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'absolute',
          top: Math.round(size.h * 0.08),
          left: 84,
          right: 84,
          bottom: Math.round(size.h * 0.1),
          justifyContent: justify,
          alignItems: 'center',
        }}
      >
        {children}
      </div>
      <Footer theme={theme} size={size} index={index} total={total} />
    </div>
  )
}

// ── Slide spec ──────────────────────────────────────────────────────────────────
export type SlideKind = 'cover' | 'content' | 'cta' | 'photo' | 'story' | 'post'

export interface SlideSpec {
  kind: SlideKind
  index: number
  total: number
  emoji?: string
  eyebrow?: string
  headline?: string
  body?: string
  subheadline?: string
  action?: string
  photoUrl?: string
}

// ── Carousel templates ──────────────────────────────────────────────────────────
function Cover({ s, theme, size }: { s: SlideSpec; theme: CarouselTheme; size: Size }): ReactElement {
  return (
    <Frame theme={theme} size={size} index={s.index} total={s.total}>
      {s.emoji ? <div style={{ display: 'flex', fontSize: 120, marginBottom: 30 }}>{s.emoji}</div> : <div style={{ display: 'flex' }} />}
      <RichText text={s.headline || ''} o={{ size: 92, weight: 900, accentWeight: 900, color: theme.text, accent: theme.accent, uppercase: true, lineGap: 8 }} />
      {s.subheadline ? (
        <div style={{ display: 'flex', marginTop: 40, width: '100%', justifyContent: 'center' }}>
          <RichText text={s.subheadline} o={{ size: 38, weight: 500, color: theme.textMuted, accent: theme.accent }} />
        </div>
      ) : (
        <div style={{ display: 'flex' }} />
      )}
    </Frame>
  )
}

function Content({ s, theme, size }: { s: SlideSpec; theme: CarouselTheme; size: Size }): ReactElement {
  return (
    <Frame theme={theme} size={size} index={s.index} total={s.total}>
      {s.emoji ? <div style={{ display: 'flex', fontSize: 96, marginBottom: 28 }}>{s.emoji}</div> : <div style={{ display: 'flex' }} />}
      {s.headline ? (
        <div style={{ display: 'flex', width: '100%', justifyContent: 'center', marginBottom: 36 }}>
          <RichText text={s.headline} o={{ size: 58, weight: 800, accentWeight: 800, color: theme.text, accent: theme.accent, uppercase: true, lineGap: 6 }} />
        </div>
      ) : (
        <div style={{ display: 'flex' }} />
      )}
      {s.body ? <RichText text={s.body} o={{ size: 42, weight: 500, color: theme.text, accent: theme.accent, lineGap: 14 }} /> : <div style={{ display: 'flex' }} />}
    </Frame>
  )
}

function CTA({ s, theme, size }: { s: SlideSpec; theme: CarouselTheme; size: Size }): ReactElement {
  return (
    <Frame theme={theme} size={size} index={s.index} total={s.total}>
      <div style={{ display: 'flex', fontSize: 104, marginBottom: 44 }}>✉️</div>
      {s.body ? <RichText text={s.body} o={{ size: 50, weight: 700, color: theme.text, accent: theme.accent, lineGap: 14 }} /> : <div style={{ display: 'flex' }} />}
      {s.action ? (
        <div style={{ display: 'flex', marginTop: 44, width: '100%', justifyContent: 'center' }}>
          <RichText text={s.action} o={{ size: 46, weight: 800, accentWeight: 800, color: theme.accent, accent: theme.accent }} />
        </div>
      ) : (
        <div style={{ display: 'flex' }} />
      )}
    </Frame>
  )
}

// ── Single post (1:1) — cover-style standalone image ────────────────────────────
function Post({ s, theme, size }: { s: SlideSpec; theme: CarouselTheme; size: Size }): ReactElement {
  return (
    <Frame theme={theme} size={size} index={0} total={1}>
      {s.emoji ? <div style={{ display: 'flex', fontSize: 100, marginBottom: 26 }}>{s.emoji}</div> : <div style={{ display: 'flex' }} />}
      <RichText text={s.headline || ''} o={{ size: 76, weight: 900, accentWeight: 900, color: theme.text, accent: theme.accent, uppercase: true, lineGap: 6 }} />
      {s.body ? (
        <div style={{ display: 'flex', marginTop: 34, width: '100%', justifyContent: 'center' }}>
          <RichText text={s.body} o={{ size: 38, weight: 500, color: theme.textMuted, accent: theme.accent, lineGap: 12 }} />
        </div>
      ) : (
        <div style={{ display: 'flex' }} />
      )}
    </Frame>
  )
}

// ── Story (9:16) — text/script over the creator's photo, in brand style ─────────
function Story({ s, theme, size }: { s: SlideSpec; theme: CarouselTheme; size: Size }): ReactElement {
  const overPhoto = !!s.photoUrl
  const onText = overPhoto ? theme.onPhotoText : theme.text
  return (
    <div style={{ display: 'flex', position: 'relative', width: size.w, height: size.h }}>
      {overPhoto ? <img src={s.photoUrl} width={size.w} height={size.h} style={{ objectFit: 'cover' }} alt="" /> : <Backdrop theme={theme} size={size} />}
      {/* top scrim + hook */}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 560,
          padding: '120px 80px 0',
          backgroundImage: overPhoto ? 'linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 100%)' : 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0) 100%)',
        }}
      >
        <RichText text={s.headline || ''} o={{ size: 56, weight: 800, accentWeight: 900, color: onText, accent: theme.accent, lineGap: 10 }} />
      </div>
      {/* bottom scrim + body/CTA + brand handle */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          minHeight: 480,
          padding: '0 80px 130px',
          justifyContent: 'flex-end',
          backgroundImage: overPhoto ? 'linear-gradient(0deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0) 100%)' : 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0) 100%)',
        }}
      >
        {s.body ? <RichText text={s.body} o={{ size: 46, weight: 600, color: onText, accent: theme.accent, lineGap: 12 }} /> : <div style={{ display: 'flex' }} />}
        {s.action ? (
          <div style={{ display: 'flex', marginTop: 28, alignSelf: 'center', backgroundColor: theme.accent, color: '#fff', fontSize: 36, fontWeight: 800, padding: '20px 44px', borderRadius: 60 }}>
            {s.action}
          </div>
        ) : (
          <div style={{ display: 'flex' }} />
        )}
      </div>
      {theme.handle ? (
        <div style={{ position: 'absolute', top: 70, left: 80, display: 'flex', color: onText, fontSize: 24, fontWeight: 800, letterSpacing: 2 }}>
          {theme.handle.toUpperCase()}
        </div>
      ) : (
        <div style={{ display: 'flex' }} />
      )}
    </div>
  )
}

// ── Photo post (any ratio) — headline over the creator's OWN photo ──────────────
// Dark bottom gradient keeps the headline readable over any image; accent words
// (**…**) stay in the brand colour. Used for "сделать картинку поста" with a photo.
function Photo({ s, theme, size }: { s: SlideSpec; theme: CarouselTheme; size: Size }): ReactElement {
  return (
    <div style={{ display: 'flex', position: 'relative', width: size.w, height: size.h }}>
      {s.photoUrl ? (
        <img src={s.photoUrl} width={size.w} height={size.h} style={{ objectFit: 'cover' }} alt="" />
      ) : (
        <Backdrop theme={theme} size={size} />
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: Math.round(size.h * 0.62),
          justifyContent: 'flex-end',
          padding: '0 72px 80px',
          backgroundImage: 'linear-gradient(0deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.30) 48%, rgba(0,0,0,0) 100%)',
        }}
      >
        <RichText text={s.headline || ''} o={{ size: 64, weight: 800, accentWeight: 900, color: '#FFFFFF', accent: theme.accent, lineGap: 8 }} />
        {s.body ? (
          <div style={{ display: 'flex', marginTop: 18, width: '100%' }}>
            <RichText text={s.body} o={{ size: 34, weight: 500, color: 'rgba(255,255,255,0.92)', accent: theme.accent, align: 'left', lineGap: 8 }} />
          </div>
        ) : (
          <div style={{ display: 'flex' }} />
        )}
        {theme.handle ? (
          <div style={{ display: 'flex', marginTop: 20, color: 'rgba(255,255,255,0.7)', fontSize: 22, fontWeight: 700, letterSpacing: 2 }}>{theme.handle.toUpperCase()}</div>
        ) : (
          <div style={{ display: 'flex' }} />
        )}
      </div>
    </div>
  )
}

export function renderSlide(s: SlideSpec, theme: CarouselTheme, size: Size): ReactElement {
  switch (s.kind) {
    case 'cover':
      return <Cover s={s} theme={theme} size={size} />
    case 'cta':
      return <CTA s={s} theme={theme} size={size} />
    case 'post':
      return <Post s={s} theme={theme} size={size} />
    case 'photo':
      return <Photo s={s} theme={theme} size={size} />
    case 'story':
      return <Story s={s} theme={theme} size={size} />
    default:
      return <Content s={s} theme={theme} size={size} />
  }
}

// ── Map a carousel's structured_data → ordered slide specs ──────────────────────
type Dict = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const arr = (v: unknown): Dict[] => (Array.isArray(v) ? (v as Dict[]) : [])

export function planSlides(carousel: Dict): SlideSpec[] {
  const cover = carousel.cover as Dict | undefined
  const slides = arr(carousel.slides)
  const last = carousel.last_slide as Dict | undefined

  const specs: Omit<SlideSpec, 'index' | 'total'>[] = []
  if (cover) specs.push({ kind: 'cover', headline: str(cover.headline), subheadline: str(cover.subheadline), emoji: str(cover.emoji) || undefined })
  for (const sl of slides) specs.push({ kind: 'content', headline: str(sl.headline) || undefined, body: str(sl.body) || undefined, emoji: str(sl.emoji) || undefined })
  if (last) specs.push({ kind: 'cta', body: str(last.text), action: str(last.action) })

  const total = specs.length
  return specs.map((sp, i) => ({ ...sp, index: i, total }) as SlideSpec)
}
