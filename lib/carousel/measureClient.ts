'use client'

// Измерение текста в браузере тем же TTF, что грузит сервер (public/fonts):
// превью и экспорт переносят строки по одним ширинам (lib/carousel/textLayout).
// Кернинг выключен намеренно: и браузер, и satori кернят (строка выходит чуть
// уже измеренной) — запас в нашу пользу, перелив за край невозможен.
import type { Measure, RunStyle } from '@/lib/carousel/textLayout'
import { fontFamilyOf } from '@/lib/fonts'

let ctx: CanvasRenderingContext2D | null = null
function getCtx(): CanvasRenderingContext2D | null {
  if (ctx) return ctx
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  ctx = c.getContext('2d')
  if (ctx && 'fontKerning' in ctx) (ctx as CanvasRenderingContext2D & { fontKerning: string }).fontKerning = 'none'
  return ctx
}

/** Имя семьи в браузере: Montserrat зарегистрирован в редакторе как MontserratEd. */
export function editorFamilyOf(key?: string | null): string {
  const fam = fontFamilyOf(key)
  return fam === 'Montserrat' ? 'MontserratEd' : fam
}

export function fontCss(family: string, size: number, weight: number, italic: boolean): string {
  return `${italic ? 'italic ' : ''}${weight} ${size}px "${family}"`
}

/**
 * Мерилка для блока: базовый вес, вес акцента, курсив всего блока. Внутри
 * строки __жирное__ слово меряется весом 800 (как рендерится), *курсив* —
 * italic. Без canvas (SSR) — эвристика движка.
 */
export function makeMeasure(opts: { family: string; size: number; weight: number; accentWeight: number; italic: boolean }): Measure {
  const c = getCtx()
  if (!c) return (text) => text.length * opts.size * 0.62
  const cache = new Map<string, number>()
  return (text: string, style: RunStyle) => {
    const weight = style.em ? opts.accentWeight : style.bold ? Math.max(opts.weight, 800) : opts.weight
    const italic = opts.italic || style.italic
    const font = fontCss(opts.family, opts.size, weight, italic)
    const key = font + '|' + text
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    c.font = font
    const w = c.measureText(text).width
    cache.set(key, w)
    return w
  }
}

/** Дождаться загрузки нужных начертаний (иначе canvas меряет запасным шрифтом). */
export async function ensureFonts(family: string, weights: number[], italic: boolean): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return
  const jobs: Promise<unknown>[] = []
  for (const w of weights) {
    jobs.push(document.fonts.load(fontCss(family, 40, w, false)).catch(() => []))
    if (italic) jobs.push(document.fonts.load(fontCss(family, 40, w, true)).catch(() => []))
  }
  await Promise.all(jobs)
}
