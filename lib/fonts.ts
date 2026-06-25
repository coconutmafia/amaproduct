// Bundled font families (full static TTFs with Cyrillic, in public/fonts).
//
// Client-safe data module — NO node imports — so both the slide engine (server,
// reads the .ttf bytes) and the brand-kit UI (client, renders the picker) share
// one source of truth. Each option maps to its Satori family name + the weight
// files we ship. Single-weight display/script faces register one file; Satori
// then uses it for any requested weight, so headlines still render.
//
// All five cover distinct moods and ship full Cyrillic glyph coverage (the PT
// family, Yeseva One and Marck Script are by Cyrillic-native designers).
export type FontFile = { file: string; weight: number; style?: 'normal' | 'italic' }

export const FONTS: Record<string, { name: string; label: string; files: FontFile[] }> = {
  montserrat: {
    name: 'Montserrat', label: 'Montserrat — геометричный, современный',
    files: [
      { file: 'Montserrat-Regular.ttf', weight: 400 },
      { file: 'Montserrat-Medium.ttf', weight: 500 },
      { file: 'Montserrat-Bold.ttf', weight: 700 },
      { file: 'Montserrat-ExtraBold.ttf', weight: 800 },
      { file: 'Montserrat-Black.ttf', weight: 900 },
      { file: 'Montserrat-Italic.ttf', weight: 400, style: 'italic' },
    ],
  },
  'pt-serif': {
    name: 'PT Serif', label: 'PT Serif — классический сериф',
    files: [
      { file: 'PTSerif-Regular.ttf', weight: 400 },
      { file: 'PTSerif-Bold.ttf', weight: 700 },
    ],
  },
  'pt-sans-narrow': {
    name: 'PT Sans Narrow', label: 'PT Sans Narrow — узкий, плакатный',
    files: [
      { file: 'PTSansNarrow-Regular.ttf', weight: 400 },
      { file: 'PTSansNarrow-Bold.ttf', weight: 700 },
    ],
  },
  yeseva: {
    name: 'Yeseva One', label: 'Yeseva One — элегантный, женственный',
    files: [{ file: 'YesevaOne-Regular.ttf', weight: 400 }],
  },
  marck: {
    name: 'Marck Script', label: 'Marck Script — рукописный',
    files: [{ file: 'MarckScript-Regular.ttf', weight: 400 }],
  },
}

export type FontKey = keyof typeof FONTS
export const DEFAULT_FONT: FontKey = 'montserrat'

// Stable list for UI pickers / AI enums (insertion order).
export const FONT_KEYS = Object.keys(FONTS) as FontKey[]

// Resolve a stored font key → the Satori family name (falls back to the default).
export function fontFamilyOf(key?: string | null): string {
  const f = key ? FONTS[key] : undefined
  return (f || FONTS[DEFAULT_FONT]).name
}
