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
  postWide: { w: 1080, h: 566 }, // 1.91:1 landscape (owner request)
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

// ── Story text (Instagram-style) ─────────────────────────────────────────────────
// We wrap words into lines ourselves (Satori has no inline box decoration):
//  • plate mode — one CONTINUOUS plate under each line, lines FLUSH together
//    (owner: «между строчек… пробелов нету» in Instagram's text background);
//  • clean mode (bg=null) — bare text for uniform backgrounds (sky etc.).
// Widow-fix: never leave a single word alone on the last line (owner: «перенос
// одного слова на новую строчку — чтоб такого не было»).
type WrapTok = { word: string; em: boolean }

function wrapOnce(tokens: ReturnType<typeof tokenize>, maxChars: number): WrapTok[][] {
  const lines: WrapTok[][] = [[]]
  let cur = 0
  for (const t of tokens) {
    if (t.br) { lines.push([]); cur = 0; continue }
    if (!t.word) continue
    const wlen = t.word.length + 1
    if (cur > 0 && cur + wlen > maxChars) { lines.push([]); cur = 0 }
    lines[lines.length - 1].push({ word: t.word, em: t.em })
    cur += wlen
  }
  return lines.filter((l) => l.length > 0)
}

const hasWidow = (lines: WrapTok[][]) => lines.length > 1 && lines[lines.length - 1].length === 1

function wrapWords(text: string, size: number, maxWidth: number): WrapTok[][] {
  const tokens = tokenize(text.trim())
  const maxChars = Math.max(8, Math.floor(maxWidth / (size * 0.62)))
  // Widow-fix, take 2 (owner: «перенос одного слова — чтоб такого не было», a
  // 2-word previous line escaped the old pull-down fix): re-wrap with a
  // slightly narrower measure until the lone last word disappears, then fall
  // back to pulling a word down.
  let out = wrapOnce(tokens, maxChars)
  for (let shrink = 2; hasWidow(out) && shrink <= 8; shrink += 2) {
    const retry = wrapOnce(tokens, Math.max(8, maxChars - shrink))
    if (!hasWidow(retry)) { out = retry; break }
  }
  for (let i = out.length - 1; i > 0; i--) {
    if (out[i].length === 1 && out[i - 1].length >= 2) {
      const moved = out[i - 1].pop()
      if (moved) out[i].unshift(moved)
    }
  }
  return out
}

function StoryText({ text, size, color, accent, bg, weight = 800, accentWeight = 900, align = 'left', maxWidth }: {
  text: string
  size: number
  color: string
  accent: string
  bg: string | null // null → clean text, no plates
  weight?: number
  accentWeight?: number
  align?: 'left' | 'center'
  maxWidth: number
}): ReactElement {
  const padX = bg ? Math.round(size * 0.26) : 0
  const padY = bg ? Math.round(size * 0.14) : 0
  const rendered = wrapWords(text, size, maxWidth - padX * 2)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align === 'center' ? 'center' : 'flex-start', width: '100%' }}>
      {rendered.map((line, li) => (
        <div key={li} style={{
          display: 'flex', flexWrap: 'wrap', maxWidth: '100%',
          backgroundColor: bg ?? 'transparent',
          padding: `${padY}px ${padX}px`,
          borderRadius: bg ? Math.round(size * 0.14) : 0,
          // Plates sit flush (IG text-bg has no inter-line gaps); clean text
          // keeps a small natural line gap.
          marginBottom: li === rendered.length - 1 ? 0 : bg ? 0 : Math.round(size * 0.18),
        }}>
          {line.map((t, i) => (
            <div key={i} style={{
              display: 'flex', fontFamily: 'Montserrat', fontSize: size, lineHeight: 1.15,
              color: t.em ? accent : color,
              fontWeight: t.em ? accentWeight : weight,
              marginRight: i === line.length - 1 ? 0 : Math.round(size * 0.24),
            }}>{t.word}</div>
          ))}
        </div>
      ))}
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
  photo,
}: {
  theme: CarouselTheme
  size: Size
  index: number
  total: number
  children: ReactElement | ReactElement[]
  justify?: 'center' | 'flex-start'
  // The creator's own photo as the slide background (owner request: «хочу сюда
  // добавлять свои картинки/подложку»). A dark scrim keeps text readable.
  photo?: string
}): ReactElement {
  const footerTheme = photo ? { ...theme, textMuted: 'rgba(255,255,255,0.85)' } : theme
  return (
    <div style={{ display: 'flex', position: 'relative', width: size.w, height: size.h }}>
      {photo ? (
        <img src={photo} width={size.w} height={size.h} style={{ objectFit: 'cover' }} alt="" />
      ) : (
        <Backdrop theme={theme} size={size} />
      )}
      {photo ? (
        <div style={{ position: 'absolute', top: 0, left: 0, width: size.w, height: size.h, display: 'flex', backgroundImage: 'linear-gradient(180deg, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0.52) 60%, rgba(0,0,0,0.66) 100%)' }} />
      ) : (
        <div style={{ display: 'flex' }} />
      )}
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
      <Footer theme={footerTheme} size={size} index={index} total={total} />
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
  // Story frames: where the text group sits (varies frame-to-frame so a series
  // doesn't look stamped — owner feedback). Default 'bottom'.
  position?: 'top' | 'center' | 'bottom'
  // Story frames: plates under text (default true over photo). plate=false →
  // clean text for uniform backgrounds, coloured via textColor.
  plate?: boolean
  textColor?: string
  // Render on a TRANSPARENT background (no Backdrop) — used to burn brand text
  // over a VIDEO with ffmpeg (the overlay PNG keeps its alpha channel).
  transparent?: boolean
}

// ── Carousel templates ──────────────────────────────────────────────────────────
function Cover({ s, theme, size }: { s: SlideSpec; theme: CarouselTheme; size: Size }): ReactElement {
  const over = !!s.photoUrl
  const tx = over ? '#FFFFFF' : theme.text
  const mu = over ? 'rgba(255,255,255,0.88)' : theme.textMuted
  return (
    <Frame theme={theme} size={size} index={s.index} total={s.total} photo={s.photoUrl}>
      {s.emoji ? <div style={{ display: 'flex', fontSize: 120, marginBottom: 30 }}>{s.emoji}</div> : <div style={{ display: 'flex' }} />}
      <RichText text={s.headline || ''} o={{ size: 92, weight: 900, accentWeight: 900, color: tx, accent: theme.accent, uppercase: true, lineGap: 8 }} />
      {s.subheadline ? (
        <div style={{ display: 'flex', marginTop: 40, width: '100%', justifyContent: 'center' }}>
          <RichText text={s.subheadline} o={{ size: 38, weight: 500, color: mu, accent: theme.accent }} />
        </div>
      ) : (
        <div style={{ display: 'flex' }} />
      )}
    </Frame>
  )
}

function Content({ s, theme, size }: { s: SlideSpec; theme: CarouselTheme; size: Size }): ReactElement {
  const over = !!s.photoUrl
  const tx = over ? '#FFFFFF' : theme.text
  return (
    <Frame theme={theme} size={size} index={s.index} total={s.total} photo={s.photoUrl}>
      {s.emoji ? <div style={{ display: 'flex', fontSize: 96, marginBottom: 28 }}>{s.emoji}</div> : <div style={{ display: 'flex' }} />}
      {s.headline ? (
        <div style={{ display: 'flex', width: '100%', justifyContent: 'center', marginBottom: 36 }}>
          <RichText text={s.headline} o={{ size: 58, weight: 800, accentWeight: 800, color: tx, accent: theme.accent, uppercase: true, lineGap: 6 }} />
        </div>
      ) : (
        <div style={{ display: 'flex' }} />
      )}
      {s.body ? <RichText text={s.body} o={{ size: 42, weight: 500, color: tx, accent: theme.accent, lineGap: 14 }} /> : <div style={{ display: 'flex' }} />}
    </Frame>
  )
}

function CTA({ s, theme, size }: { s: SlideSpec; theme: CarouselTheme; size: Size }): ReactElement {
  const over = !!s.photoUrl
  const tx = over ? '#FFFFFF' : theme.text
  return (
    <Frame theme={theme} size={size} index={s.index} total={s.total} photo={s.photoUrl}>
      <div style={{ display: 'flex', fontSize: 104, marginBottom: 44 }}>✉️</div>
      {s.body ? <RichText text={s.body} o={{ size: 50, weight: 700, color: tx, accent: theme.accent, lineGap: 14 }} /> : <div style={{ display: 'flex' }} />}
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
// Owner methodology (lesson «Визуальная концепция»): text on photo must sit in
// readable PLATES in the brand colours (no alien white gradients), key words in
// the accent colour, and the text group position varies frame-to-frame.
function Story({ s, theme, size }: { s: SlideSpec; theme: CarouselTheme; size: Size }): ReactElement {
  // Over a photo OR over video (transparent overlay) the text needs the same
  // treatment: plates in brand colours, or clean text in a picked colour.
  const overPhoto = !!s.photoUrl || !!s.transparent
  const pos = s.position || 'bottom'
  const justify = pos === 'top' ? 'flex-start' : pos === 'center' ? 'center' : 'flex-end'
  const txt = theme.text
  const contentW = size.w - 2 * 72
  return (
    <div style={{ display: 'flex', position: 'relative', width: size.w, height: size.h }}>
      {s.photoUrl ? (
        <img src={s.photoUrl} width={size.w} height={size.h} style={{ objectFit: 'cover' }} alt="" />
      ) : s.transparent ? (
        <div style={{ display: 'flex' }} />
      ) : (
        <Backdrop theme={theme} size={size} />
      )}

      {/* single text group, varies per frame */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          padding: '190px 72px 150px',
          justifyContent: justify,
        }}
      >
        {overPhoto ? (
          // Plates carry readability over busy photos; on uniform areas the
          // page passes plate=false → clean text in a photo-picked colour.
          <StoryText text={s.headline || ''} size={58} weight={800} accentWeight={900}
            color={s.plate === false ? (s.textColor || '#FFFFFF') : txt}
            accent={theme.accent} bg={s.plate === false ? null : theme.bg} maxWidth={contentW} />
        ) : (
          <RichText text={s.headline || ''} o={{ size: 58, weight: 800, accentWeight: 900, color: txt, accent: theme.accent, lineGap: 14 }} />
        )}
        {s.body ? (
          <div style={{ display: 'flex', marginTop: 26, width: '100%' }}>
            {overPhoto ? (
              <StoryText text={s.body} size={42} weight={600} accentWeight={800}
                color={s.plate === false ? (s.textColor || '#FFFFFF') : txt}
                accent={theme.accent} bg={s.plate === false ? null : theme.bg} maxWidth={contentW} />
            ) : (
              <RichText text={s.body} o={{ size: 42, weight: 600, color: txt, accent: theme.accent, lineGap: 12 }} />
            )}
          </div>
        ) : (
          <div style={{ display: 'flex' }} />
        )}
        {s.action ? (
          <div style={{ display: 'flex', marginTop: 34, alignSelf: 'center', backgroundColor: theme.accent, color: '#fff', fontSize: 36, fontWeight: 800, padding: '20px 44px', borderRadius: 60 }}>
            {s.action}
          </div>
        ) : (
          <div style={{ display: 'flex' }} />
        )}
      </div>

      {theme.handle ? (
        <div style={{ position: 'absolute', top: 70, left: 72, display: 'flex' }}>
          <div style={{ display: 'flex', color: overPhoto ? theme.text : theme.textMuted, backgroundColor: overPhoto ? theme.bg : 'transparent', padding: overPhoto ? '8px 16px' : 0, borderRadius: 10, fontSize: 24, fontWeight: 800, letterSpacing: 2 }}>
            {theme.handle.toUpperCase()}
          </div>
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
  // Auto-fit the hook: short hooks render big and punchy, longer ones step down
  // so they never overflow the image. The full post lives in the caption, not here.
  const hl = s.headline || ''
  const hlSize = hl.length <= 24 ? 78 : hl.length <= 40 ? 66 : hl.length <= 60 ? 54 : 46
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
        <RichText text={hl} o={{ size: hlSize, weight: 800, accentWeight: 900, color: '#FFFFFF', accent: theme.accent, lineGap: 8 }} />
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
