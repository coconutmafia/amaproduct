// Readability contract for brand colour pairs (client-safe, no platform imports —
// shared by the server slide engine, the brand-kit extractor and DOM previews,
// so «превью = экспорт» holds for the corrected colours too).
//
// WHY THIS EXISTS (Илона Залошвили, 28.08): the AI brand extractor returned her
// story style as text #F5F1EA on bg #F2EDE4 — the colour of text ON the dusty-rose
// plates of her samples, paired with the paper background. Contrast 1.04:1 — the
// engine rendered every plate with invisible text. The kit is a pair of colours
// with an implicit contract «text is readable on bg», and NOTHING enforced it:
// not the extractor at save time, not the renderers at draw time. Prod sweep
// found 4 broken kits of 46 (white-on-white included). Both halves now enforce:
// the extractor normalises before saving, and every renderer resolves through
// these helpers so even legacy-stored pairs draw readable.
//
// Thresholds: WCAG large-text minimum is 3.0 (our story/carousel text is 42px+
// bold). A pair at or above 3.0 is the creator's style — DON'T touch it (prod
// distribution is bimodal: broken ≤2.2, healthy ≥7.8, nothing in between).
// Below 3.0 the pair is defect, and we correct the TEXT (never the background —
// the bg is the brand's surface) by blending it toward black or white, keeping
// as much of its own hue as the target allows.

const FIRE_BELOW = 3 // pairs under this are unreadable → correct
const TEXT_TARGET = 4.5 // corrected body/plate text lands comfortably readable
const ACCENT_TARGET = 3 // corrected accent words keep maximum brand hue

function channels(hex: string): [number, number, number] | null {
  const h = (hex || '').trim().replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

// WCAG relative luminance (sRGB, linearised) — NOT the cheap perceptual mix the
// engine uses for its dark/light switch; contrast ratios need the real formula.
function relLum(hex: string): number | null {
  const ch = channels(hex)
  if (!ch) return null
  const [r, g, b] = ch.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// 1 (identical) … 21 (black on white). Unparseable input → 21: the guard only
// corrects KNOWN-bad pairs; unknown formats pass through untouched.
export function contrastRatio(a: string, b: string): number {
  const la = relLum(a)
  const lb = relLum(b)
  if (la == null || lb == null) return 21
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

function blendToward(hex: string, pole: 0 | 255, t: number): string {
  const ch = channels(hex)
  if (!ch) return hex
  const mix = (v: number) => Math.round(v + (pole - v) * t).toString(16).padStart(2, '0')
  return `#${mix(ch[0])}${mix(ch[1])}${mix(ch[2])}`
}

// Make `preferred` readable on `bg`: keep it when the pair already clears the
// fire threshold; otherwise blend it toward the pole (black/white) that reads
// better on this bg, stopping at the FIRST step that clears `target` — so the
// corrected colour keeps as much of the brand hue as readability allows. The
// better pole always reaches ≥4.58 on any bg, so the walk always terminates.
export function readableTextOn(
  bg: string,
  preferred: string,
  { fire = FIRE_BELOW, target = TEXT_TARGET }: { fire?: number; target?: number } = {},
): string {
  if (contrastRatio(bg, preferred) >= fire) return preferred
  const bgLum = relLum(bg)
  if (bgLum == null) return preferred
  const pole: 0 | 255 = contrastRatio(bg, '#000000') >= contrastRatio(bg, '#FFFFFF') ? 0 : 255
  for (let t = 0.1; t <= 1.001; t += 0.1) {
    const c = blendToward(preferred, pole, t)
    if (contrastRatio(bg, c) >= target) return c
  }
  return pole === 0 ? '#000000' : '#FFFFFF'
}

// The two brand roles, with their thresholds — use THESE at every surface that
// draws brand text/accent on the brand background (plates included: plate bg IS
// the brand bg).
export function resolveBrandText(bg: string, text: string): string {
  return readableTextOn(bg, text, { fire: FIRE_BELOW, target: TEXT_TARGET })
}
export function resolveBrandAccent(bg: string, accent: string): string {
  return readableTextOn(bg, accent, { fire: FIRE_BELOW, target: ACCENT_TARGET })
}

// Extractor-side normalisation: the same contract applied BEFORE the kit is
// stored, so newly analysed kits are sane on disk (renderers still guard for
// legacy rows). Returns which roles changed so the caller can log/report.
export function normalizeBrandColors(kit: { bg: string; text: string; accent: string }): {
  bg: string; text: string; accent: string; changed: ('text' | 'accent')[]
} {
  const text = resolveBrandText(kit.bg, kit.text)
  const accent = resolveBrandAccent(kit.bg, kit.accent)
  const changed: ('text' | 'accent')[] = []
  if (text !== kit.text) changed.push('text')
  if (accent !== kit.accent) changed.push('accent')
  return { bg: kit.bg, text, accent, changed }
}
