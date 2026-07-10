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
import { ArrowSvg, Badge, SHAPE_ASPECT, type FreeShape } from './shapes'
import { FONTS, fontFamilyOf } from '@/lib/fonts'

// ── Formats ─────────────────────────────────────────────────────────────────────
export const FORMATS = {
  carousel: { w: 1080, h: 1350 }, // 4:5
  post: { w: 1080, h: 1080 }, // 1:1
  post45: { w: 1080, h: 1350 }, // 4:5 single post (best for IG feed reach)
  postWide: { w: 1080, h: 566 }, // 1.91:1 landscape (owner request)
  carouselWide: { w: 1080, h: 608 }, // 16:9 landscape carousel (tester request)
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
  accentStyle: 'gradient' | 'flat' // **word** fill: brand gradient sheen, or flat accent
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
  accentStyle: 'gradient',
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
  font?: string | null              // bundled font key (see FONTS); default Montserrat
  accentStyle?: 'gradient' | 'flat' | null // **word** fill style; default gradient
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
function darken(hex: string, amt: number): string {
  const h = hex.replace('#', '')
  if (h.length < 6) return hex
  const ch = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16)
    return Math.round(v * (1 - amt)).toString(16).padStart(2, '0')
  }
  return `#${ch(0)}${ch(2)}${ch(4)}`
}

export function themeFromBrand(brand?: BrandInput): CarouselTheme {
  const bg = brand?.bg?.trim() || DEFAULT_THEME.bg
  const dark = hexLum(bg) < 0.5 // dark brand → white text + light-on-dark muted
  const accentColor = brand?.accentColor?.trim()
  const accent = accentColor || DEFAULT_THEME.accent
  // Emphasis (**word**) gradient follows the brand accent so accent words come
  // out in the creator's own colour — not a fixed warm pink→orange. Owner
  // feedback (25 Jun): a teal-brand post still rendered pink accents («убрать
  // эти розовые»). A subtle light→accent→deep ramp keeps the gradient sheen on
  // any hue. With no brand accent we keep the curated warm default.
  const grad = accentColor
    ? { gradFrom: lighten(accent, 0.22), gradMid: accent, gradTo: darken(accent, 0.1) }
    : { gradFrom: DEFAULT_THEME.gradFrom, gradMid: DEFAULT_THEME.gradMid, gradTo: DEFAULT_THEME.gradTo }
  return {
    ...DEFAULT_THEME,
    accent,
    ...grad,
    accentStyle: brand?.accentStyle === 'flat' ? 'flat' : 'gradient',
    fontFamily: fontFamilyOf(brand?.font),
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
  // Register EVERY bundled family so any project's chosen font renders. Satori
  // matches family + nearest weight, so single-weight faces still serve any size.
  const defs = await Promise.all(
    Object.values(FONTS).flatMap((fam) =>
      fam.files.map(async (f): Promise<FontDef> => ({
        name: fam.name,
        data: await readFile(join(dir, f.file)),
        weight: f.weight,
        style: f.style ?? 'normal',
      })),
    ),
  )
  fontCache = defs
  return fontCache
}

// ── Rich text: inline accent via **markers** (Satori has no inline spans, so we
//    tokenise into flex-wrap word chips and colour/weight the emphasised ones) ───
type RichOpts = {
  size: number
  weight?: number
  color: string
  accent: string
  align?: 'center' | 'left' | 'right'
  lineGap?: number
  uppercase?: boolean
  accentWeight?: number
  // When set, **accent** words get a gradient fill (background-clip:text) instead
  // of the flat accent colour — owner reference: headline accents in a warm
  // pink→orange gradient. Satori supports backgroundClip:'text' + transparent.
  accentGrad?: { from: string; mid: string; to: string }
}

// Emphasis (**word**) colour: a clipped gradient when accentGrad is set, else flat.
function emFill(o: RichOpts): Record<string, string> {
  if (!o.accentGrad) return { color: o.accent }
  return {
    backgroundImage: `linear-gradient(110deg, ${o.accentGrad.from}, ${o.accentGrad.mid}, ${o.accentGrad.to})`,
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
    color: 'transparent',
    WebkitTextFillColor: 'transparent',
  }
}

// The accent gradient to hand a headline RichText — or undefined when the brand
// chose a flat accent (then emFill renders the solid accent colour, no sheen).
// Lets a creator turn the gradient off entirely (owner feedback: «без розового»).
function headlineGrad(theme: CarouselTheme): RichOpts['accentGrad'] {
  return theme.accentStyle === 'flat'
    ? undefined
    : { from: theme.gradFrom, mid: theme.gradMid, to: theme.gradTo }
}

function tokenize(text: string): { word: string; em: boolean; br?: boolean }[] {
  const out: { word: string; em: boolean; br?: boolean }[] = []
  // [[...]] are plate-span markers (handled by StoryText); strip them here so
  // they never render literally on any other surface (RichText, carousels).
  const segs = text.replace(/\[\[|\]\]/g, '').split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
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
        justifyContent: o.align === 'left' ? 'flex-start' : o.align === 'right' ? 'flex-end' : 'center',
        alignItems: 'baseline',
        // fontFamily inherited from the slide root (theme.fontFamily) so the
        // creator's chosen font drives all text. Falls back to Montserrat.
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
              ...(it.em ? emFill(o) : { color: o.color }),
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

// Selective plating: [[...]] marks a span that gets a plate while the rest sits
// plain on the photo (owner: «выдели подложкой только первое предложение,
// остальное не выделяй»). Without any [[]] the whole block follows
// `defaultPlated` (photo-driven), so existing series are unchanged.
type PlateSeg = { plated: boolean; text: string }

function parsePlateSegments(text: string, defaultPlated: boolean): PlateSeg[] {
  if (!text.includes('[[')) return [{ plated: defaultPlated, text }]
  const segs: PlateSeg[] = []
  const re = /\[\[([\s\S]+?)\]\]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) { const t = text.slice(last, m.index); if (t.trim()) segs.push({ plated: false, text: t }) }
    if (m[1].trim()) segs.push({ plated: true, text: m[1] })
    last = re.lastIndex
  }
  if (last < text.length) { const t = text.slice(last); if (t.trim()) segs.push({ plated: false, text: t }) }
  return segs.length ? segs : [{ plated: defaultPlated, text }]
}

function StoryText({ text, size, accent, plateBg, platedColor, plainColor, defaultPlated, weight = 800, accentWeight = 900, maxWidth }: {
  text: string
  size: number
  accent: string
  plateBg: string      // plate background (brand bg) under plated spans
  platedColor: string  // text colour on a plate
  plainColor: string   // text colour without a plate (over photo)
  defaultPlated: boolean
  weight?: number
  accentWeight?: number
  maxWidth: number
}): ReactElement {
  const segs = parsePlateSegments(text, defaultPlated)
  const padX = Math.round(size * 0.26)
  const padY = Math.round(size * 0.14)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%' }}>
      {segs.map((seg, si) => {
        const plated = seg.plated
        const color = plated ? platedColor : plainColor
        const lines = wrapWords(seg.text, size, maxWidth - (plated ? padX * 2 : 0))
        return (
          <div key={si} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%',
            marginTop: si === 0 ? 0 : Math.round(size * 0.22),
          }}>
            {lines.map((line, li) => (
              <div key={li} style={{
                display: 'flex', flexWrap: 'wrap', maxWidth: '100%',
                backgroundColor: plated ? plateBg : 'transparent',
                padding: plated ? `${padY}px ${padX}px` : '0px',
                borderRadius: plated ? Math.round(size * 0.14) : 0,
                // Plates sit flush (IG text-bg has no inter-line gaps); plain
                // text keeps a small natural line gap.
                marginBottom: li === lines.length - 1 ? 0 : plated ? 0 : Math.round(size * 0.18),
              }}>
                {line.map((t, i) => (
                  <div key={i} style={{
                    // fontFamily inherited from the slide root (theme.fontFamily).
                    display: 'flex', fontSize: size, lineHeight: 1.15,
                    color: t.em ? accent : color,
                    fontWeight: t.em ? accentWeight : weight,
                    marginRight: i === line.length - 1 ? 0 : Math.round(size * 0.24),
                  }}>{t.word}</div>
                ))}
              </div>
            ))}
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
    <div style={{ display: 'flex', position: 'relative', width: size.w, height: size.h, fontFamily: theme.fontFamily }}>
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
export type SlideKind = 'cover' | 'content' | 'cta' | 'photo' | 'story' | 'post' | 'scheme' | 'free'

// A freely-positioned block for the «Instagram-style» editor (kind 'free').
// type 'text' is the default (back-compat: older saved blocks carry no type).
// Element library (step b): 'shape' = arrow / curved arrow / numbered badge;
// 'image' = a sticker / flat illustration (uploaded or AI-generated).
export interface FreeBlock {
  type?: 'text' | 'image' | 'shape'
  text?: string         // text (and the number for a 'badge' shape)
  src?: string          // image source (type 'image')
  shape?: FreeShape     // shape kind (type 'shape')
  xPct: number          // top-left position as a fraction of the canvas (0..1)
  yPct: number
  widthPct?: number     // width as a fraction of canvas width (text wrap / element size)
  aspect?: number       // w/h ratio for image & shape blocks (height = width/aspect)
  size?: number         // text font size in canvas px (default 56)
  color?: string        // text colour / shape stroke or fill (default white / accent)
  plate?: boolean       // brand plate behind the text
  align?: 'left' | 'center' | 'right'
  rotation?: number     // degrees, rotated around the block centre
}

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
  // Scheme frames: ordered stages drawn as staggered blocks joined by hand-drawn
  // connector lines (owner request — «сторис-схемы»). headline = intro line above.
  steps?: string[]
  // Free editor frames: text blocks positioned anywhere over a photo (drag editor).
  blocks?: FreeBlock[]
  // Free editor: two photos stacked (top half / bottom half) — owner's «2 фото на
  // слайд» storytelling layout (Да, я … / Но …). Blocks sit on top of both.
  split?: { top?: string; bottom?: string }
}

// ── Carousel templates ──────────────────────────────────────────────────────────
function Cover({ s, theme, size }: { s: SlideSpec; theme: CarouselTheme; size: Size }): ReactElement {
  const over = !!s.photoUrl
  const tx = over ? '#FFFFFF' : theme.text
  const mu = over ? 'rgba(255,255,255,0.88)' : theme.textMuted
  return (
    <Frame theme={theme} size={size} index={s.index} total={s.total} photo={s.photoUrl}>
      {s.emoji ? <div style={{ display: 'flex', fontSize: 120, marginBottom: 30 }}>{s.emoji}</div> : <div style={{ display: 'flex' }} />}
      <RichText text={s.headline || ''} o={{ size: 92, weight: 900, accentWeight: 900, color: tx, accent: theme.accent, accentGrad: headlineGrad(theme), uppercase: true, lineGap: 8 }} />
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
          <RichText text={s.headline} o={{ size: 58, weight: 800, accentWeight: 800, color: tx, accent: theme.accent, accentGrad: headlineGrad(theme), uppercase: true, lineGap: 6 }} />
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
      <RichText text={s.headline || ''} o={{ size: 76, weight: 900, accentWeight: 900, color: theme.text, accent: theme.accent, accentGrad: headlineGrad(theme), uppercase: true, lineGap: 6 }} />
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
  // A frame is "selective" when any [[...]] plate-span marker is present — then
  // unmarked text renders plain, so «выдели только X» plates X and nothing else.
  const selective = /\[\[/.test(`${s.headline || ''}${s.body || ''}`)
  const defaultPlated = selective ? false : s.plate !== false
  const plainColor = s.textColor || '#FFFFFF'
  return (
    <div style={{ display: 'flex', position: 'relative', width: size.w, height: size.h, fontFamily: theme.fontFamily }}>
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
            accent={theme.accent} plateBg={theme.bg} platedColor={txt}
            plainColor={plainColor} defaultPlated={defaultPlated} maxWidth={contentW} />
        ) : (
          <RichText text={s.headline || ''} o={{ size: 58, weight: 800, accentWeight: 900, color: txt, accent: theme.accent, lineGap: 14 }} />
        )}
        {s.body ? (
          <div style={{ display: 'flex', marginTop: 26, width: '100%' }}>
            {overPhoto ? (
              <StoryText text={s.body} size={42} weight={600} accentWeight={800}
                accent={theme.accent} plateBg={theme.bg} platedColor={txt}
                plainColor={plainColor} defaultPlated={defaultPlated} maxWidth={contentW} />
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
    <div style={{ display: 'flex', position: 'relative', width: size.w, height: size.h, fontFamily: theme.fontFamily }}>
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

// ── Scheme (9:16) — staggered stages joined by hand-drawn connectors ────────────
// Owner request («сторис-схемы»): an intro line + a flow of stages that descend,
// alternating left/right, linked by curved hand-drawn strokes. Reads best on a
// dark backdrop (her reference). **word** = brand-accent.
function Scheme({ s, theme, size }: { s: SlideSpec; theme: CarouselTheme; size: Size }): ReactElement {
  const W = size.w, H = size.h
  const pad = 96
  const steps = (s.steps || []).filter((t) => t && t.trim()).slice(0, 6)
  const n = steps.length
  const bg = '#121214'
  const fg = '#FFFFFF'
  const yStart = s.headline ? 600 : 380
  const yEnd = H - 230
  const rowH = n > 0 ? (yEnd - yStart) / n : 0
  // Each stage alternates side; connector anchor sits on its inner edge.
  const rows = steps.map((_, i) => {
    const cy = yStart + rowH * (i + 0.5)
    const left = i % 2 === 0
    return { cy, left, ax: left ? 300 : W - 300 }
  })

  return (
    <div style={{ display: 'flex', position: 'relative', width: W, height: H, backgroundColor: bg, fontFamily: theme.fontFamily }}>
      {/* hand-drawn connectors between consecutive stages */}
      <svg width={W} height={H} style={{ position: 'absolute', top: 0, left: 0 }}>
        {rows.slice(0, -1).map((a, i) => {
          const b = rows[i + 1]
          const x1 = a.ax, y1 = a.cy + 46
          const x2 = b.ax, y2 = b.cy - 46
          const d = `M ${x1} ${y1} C ${x1 + (b.left ? -40 : 40)} ${y1 + 70}, ${x2 + (a.left ? 40 : -40)} ${y2 - 70}, ${x2} ${y2}`
          return <path key={i} d={d} stroke={fg} strokeWidth={5} fill="none" strokeLinecap="round" opacity={0.9} />
        })}
      </svg>

      {/* intro line */}
      {s.headline ? (
        <div style={{ position: 'absolute', top: 170, left: pad, right: pad, display: 'flex', justifyContent: 'center' }}>
          <RichText text={s.headline} o={{ size: 40, weight: 500, color: 'rgba(255,255,255,0.9)', accent: theme.accent, align: 'center', lineGap: 10 }} />
        </div>
      ) : <div style={{ display: 'flex' }} />}

      {/* stages */}
      {steps.map((stp, i) => {
        const a = rows[i]
        return (
          <div key={i} style={{
            position: 'absolute', top: a.cy - 46, display: 'flex',
            maxWidth: W - 2 * pad - 80,
            ...(a.left ? { left: pad } : { right: pad }),
          }}>
            <RichText text={stp} o={{ size: 60, weight: 800, accentWeight: 900, color: fg, accent: theme.accent, accentGrad: headlineGrad(theme), align: a.left ? 'left' : 'right', lineGap: 4 }} />
          </div>
        )
      })}
    </div>
  )
}

// ── Free (9:16) — text / shapes / images placed anywhere (drag editor) ──────────
// Element library (step b): besides text, blocks can be draggable arrows, curved
// arrows, numbered badges (shape) and stickers / illustrations (image). Drag /
// scale / rotate live in the editor; this just renders the final positions.
function Free({ s, theme, size }: { s: SlideSpec; theme: CarouselTheme; size: Size }): ReactElement {
  const W = size.w, H = size.h
  const blocks = (s.blocks || []).filter((b) => b && (
    (b.type === 'image' && b.src) ||
    (b.type === 'shape' && b.shape) ||
    (!!b.text && b.text.trim().length > 0)   // text / icon (default)
  ))
  const half = Math.round(H / 2)
  return (
    <div style={{ display: 'flex', position: 'relative', width: W, height: H, fontFamily: theme.fontFamily }}>
      {s.split && (s.split.top || s.split.bottom) ? (
        <div style={{ display: 'flex', flexDirection: 'column', position: 'absolute', top: 0, left: 0, width: W, height: H }}>
          <div style={{ display: 'flex', width: W, height: half, overflow: 'hidden' }}>
            {s.split.top
              ? <img src={s.split.top} width={W} height={half} style={{ objectFit: 'cover' }} alt="" />
              : <div style={{ display: 'flex', width: W, height: half, backgroundColor: '#1c1c1e' }} />}
          </div>
          <div style={{ display: 'flex', width: W, height: H - half, overflow: 'hidden' }}>
            {s.split.bottom
              ? <img src={s.split.bottom} width={W} height={H - half} style={{ objectFit: 'cover' }} alt="" />
              : <div style={{ display: 'flex', width: W, height: H - half, backgroundColor: '#1c1c1e' }} />}
          </div>
        </div>
      ) : s.photoUrl
        ? <img src={s.photoUrl} width={W} height={H} style={{ objectFit: 'cover' }} alt="" />
        : <Backdrop theme={theme} size={size} />}
      {blocks.map((b, i) => {
        const left = Math.round((b.xPct ?? 0) * W)
        const top = Math.round((b.yPct ?? 0) * H)
        const rot = b.rotation ? { transform: `rotate(${b.rotation}deg)`, transformOrigin: 'center' as const } : {}
        const type = b.type || 'text'

        if (type === 'image' && b.src) {
          const w = Math.round((b.widthPct ?? 0.4) * W)
          const h = Math.round(w / (b.aspect || 1))
          return (
            <div key={i} style={{ position: 'absolute', left, top, width: w, height: h, display: 'flex', ...rot }}>
              <img src={b.src} width={w} height={h} style={{ objectFit: 'contain' }} alt="" />
            </div>
          )
        }
        if (type === 'shape' && b.shape) {
          const w = Math.round((b.widthPct ?? 0.4) * W)
          if (b.shape === 'badge') {
            return (
              <div key={i} style={{ position: 'absolute', left, top, display: 'flex', ...rot }}>
                <Badge size={w} color={b.color || theme.accent} label={(b.text || '1').trim() || '1'} />
              </div>
            )
          }
          const h = Math.round(w / (b.aspect || SHAPE_ASPECT[b.shape] || 3))
          return (
            <div key={i} style={{ position: 'absolute', left, top, width: w, height: h, display: 'flex', ...rot }}>
              <ArrowSvg w={w} h={h} color={b.color || theme.accent} curve={b.shape === 'arrow-curve'} />
            </div>
          )
        }

        // text / icon (default)
        const blockW = Math.round((b.widthPct ?? 0.8) * W)
        return (
          <div key={i} style={{ position: 'absolute', left, top, width: blockW, display: 'flex', ...rot }}>
            {b.plate
              ? <StoryText text={b.text || ''} size={b.size ?? 56} accent={theme.accent} plateBg={theme.bg}
                  platedColor={theme.text} plainColor={b.color || '#FFFFFF'} defaultPlated maxWidth={blockW} />
              : <RichText text={b.text || ''} o={{ size: b.size ?? 56, weight: 800, accentWeight: 900, color: b.color || '#FFFFFF', accent: theme.accent, align: b.align || 'left', lineGap: 6 }} />}
          </div>
        )
      })}
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
    case 'scheme':
      return <Scheme s={s} theme={theme} size={size} />
    case 'free':
      return <Free s={s} theme={theme} size={size} />
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
