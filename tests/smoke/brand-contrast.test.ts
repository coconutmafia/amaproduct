import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  contrastRatio, readableTextOn, resolveBrandText, resolveBrandAccent, normalizeBrandColors,
} from '../../lib/carousel/contrast'
import { themeFromBrand, DEFAULT_THEME } from '../../lib/carousel/engine'
import { pickPlacement, type PhotoBands } from '../../lib/photoBands'

// Стражи класса «пара цветов из кита нечитаема» (Илона Залошвили, 28.08:
// «думала ИИ будет прям сразу с фирменным стилем оформлять фотки для сторис…
// но он создаёт вот так» — плашки с невидимым текстом).
//
// Природа класса: AI-экстрактор возвращает text_color с ЦВЕТНЫХ ПЛАШЕК
// примеров, а фон — с бумаги; пара (bg, text) выходит без контраста, и НИ ОДНА
// сторона не держала контракт «текст читается на фоне». Свип прода (46
// проектов): Илона #F5F1EA/#F2EDE4 (1.04), Радмила #FFFFFF/#FFFFFF (1.00),
// Даша #ffffff/#A8B5A2 (2.14), Кристина — акцент #A6CCEB на фоне #E9D9C0
// (1.22, невидимые акценты в каруселях). Распределение бимодально: сломанные
// ≤2.2, здоровые ≥7.8 → порог 3.0 (WCAG для крупного текста) ничего живого
// не задевает.
//
// ОБЕ половины: (1) рендер — themeFromBrand чинит пару на единственной точке,
// через которую идут все серверные рендеры; клиентские превью (FreeCanvas) и
// photoBands зеркалят теми же хелперами (превью = экспорт); (2) экстрактор —
// normalizeBrandColors ДО записи в кит, чтобы новые киты были здоровы на диске.

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// Реальные пары с прода (свип 29.08)
const ILONA = { bg: '#F2EDE4', text: '#F5F1EA', accent: '#B0687F' }
const RADMILA = { bg: '#FFFFFF', text: '#FFFFFF' }
const DASHA = { bg: '#A8B5A2', text: '#ffffff' }
const KRISTINA = { bg: '#E9D9C0', accent: '#A6CCEB' }

describe('contrastRatio', () => {
  it('чёрный на белом = 21, идентичные = 1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0)
    expect(contrastRatio('#F2EDE4', '#F2EDE4')).toBeCloseTo(1, 2)
  })
  it('пара Илоны фактически нечитаема (<1.1)', () => {
    expect(contrastRatio(ILONA.bg, ILONA.text)).toBeLessThan(1.1)
  })
  it('непарсибельный цвет не триггерит поправку (возврат 21)', () => {
    expect(contrastRatio('rgba(0,0,0,.5)', '#FFFFFF')).toBe(21)
  })
})

describe('readableTextOn: чинит только сломанное', () => {
  it('читаемая пара проходит НЕТРОНУТОЙ (стиль клиента не переписываем)', () => {
    // Реальные здоровые киты прода: текст Илоны для постов, дефолт движка
    expect(resolveBrandText('#F3EFE7', '#1C1C1C')).toBe('#1C1C1C')
    expect(resolveBrandText(DEFAULT_THEME.bg, DEFAULT_THEME.text)).toBe(DEFAULT_THEME.text)
    expect(resolveBrandAccent(DEFAULT_THEME.bg, DEFAULT_THEME.accent)).toBe(DEFAULT_THEME.accent)
  })
  it('пара Илоны: текст дотемняется до ≥4.5, фон не трогается', () => {
    const fixed = resolveBrandText(ILONA.bg, ILONA.text)
    expect(fixed).not.toBe(ILONA.text)
    expect(contrastRatio(ILONA.bg, fixed)).toBeGreaterThanOrEqual(4.5)
  })
  it('белое-на-белом (Радмила) → тёмный текст', () => {
    const fixed = resolveBrandText(RADMILA.bg, RADMILA.text)
    expect(contrastRatio('#FFFFFF', fixed)).toBeGreaterThanOrEqual(4.5)
  })
  it('белый на шалфейном (Даша, 2.14) → читаемый', () => {
    const fixed = resolveBrandText(DASHA.bg, DASHA.text)
    expect(contrastRatio(DASHA.bg, fixed)).toBeGreaterThanOrEqual(4.5)
  })
  it('акцент Кристины на её фоне → ≥3 (акцент держит максимум фирменного тона)', () => {
    const fixed = resolveBrandAccent(KRISTINA.bg, KRISTINA.accent)
    expect(fixed).not.toBe(KRISTINA.accent)
    expect(contrastRatio(KRISTINA.bg, fixed)).toBeGreaterThanOrEqual(3)
  })
  it('на любом фоне поправка достигает цели (у лучшего полюса всегда ≥4.5)', () => {
    for (const bg of ['#000000', '#FFFFFF', '#777777', '#2E2E30', '#A8B5A2', '#123456']) {
      const fixed = readableTextOn(bg, bg) // худший вход: текст = фон
      expect(contrastRatio(bg, fixed)).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('themeFromBrand держит контракт читаемости (единая точка всех рендеров)', () => {
  it('кит Илоны → и текст плашек, и акцент читаемы на фоне', () => {
    const t = themeFromBrand({ bg: ILONA.bg, text: ILONA.text, accentColor: ILONA.accent, bgStyle: 'paper' })
    expect(t.bg).toBe(ILONA.bg) // фон — поверхность бренда, не трогаем
    expect(contrastRatio(t.bg, t.text)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(t.bg, t.accent)).toBeGreaterThanOrEqual(3)
  })
  it('градиент акцента строится из ПОПРАВЛЕННОГО акцента (иначе **слова** мерцали бы невидимым)', () => {
    const t = themeFromBrand({ bg: KRISTINA.bg, accentColor: KRISTINA.accent })
    expect(t.gradMid).toBe(t.accent)
    expect(contrastRatio(t.bg, t.gradMid)).toBeGreaterThanOrEqual(3)
  })
  it('onAccent: на светлом акценте CTA-пилюли текст тёмный, на тёмном — белый', () => {
    const light = themeFromBrand({ bg: '#FFFFFF', accentColor: '#A6CCEB' })
    expect(contrastRatio(light.accent, light.onAccent)).toBeGreaterThanOrEqual(3)
    const dark = themeFromBrand({ bg: '#F3EEE7', accentColor: '#7B2639' })
    expect(dark.onAccent).toBe('#FFFFFF')
  })
  it('без кита тема БАЙТ-В-БАЙТ дефолтная (вид существующих клиентов не менялся)', () => {
    const t = themeFromBrand()
    expect(t.text).toBe(DEFAULT_THEME.text)
    expect(t.accent).toBe(DEFAULT_THEME.accent)
    expect(t.gradFrom).toBe(DEFAULT_THEME.gradFrom)
    expect(t.onAccent).toBe('#FFFFFF')
  })
  it('тёмный бренд: белый текст выживает как раньше', () => {
    const t = themeFromBrand({ bg: '#121214' })
    expect(t.text).toBe('#FFFFFF')
  })
})

describe('photoBands: «тёмный брендовый текст» — проверяемое допущение', () => {
  const brightCalm: PhotoBands = {
    top: { variance: 0.001, lum: 0.9, skin: 0 },
    center: { variance: 0.05, lum: 0.5, skin: 0.3 },
    bottom: { variance: 0.001, lum: 0.9, skin: 0 },
  }
  it('почти белый цвет из кита НЕ идёт чистым текстом на светлую зону', () => {
    const p = pickPlacement(brightCalm, ILONA.text)
    expect(p.plate).toBe(false)
    expect(p.textColor).toBe('#1A1A1A')
  })
  it('настоящий тёмный брендовый текст сохраняется', () => {
    const p = pickPlacement(brightCalm, '#1C1C1C')
    expect(p.textColor).toBe('#1C1C1C')
  })
})

describe('normalizeBrandColors: экстрактор не сохраняет нечитаемый кит', () => {
  it('кейс Илоны: text чинится, bg/accent целы, отчёт о правке есть', () => {
    const n = normalizeBrandColors({ bg: ILONA.bg, text: ILONA.text, accent: ILONA.accent })
    expect(n.bg).toBe(ILONA.bg)
    expect(contrastRatio(n.bg, n.text)).toBeGreaterThanOrEqual(4.5)
    expect(n.changed).toContain('text')
  })
  it('здоровый кит проходит без правок', () => {
    const n = normalizeBrandColors({ bg: '#F3EFE7', text: '#1C1C1C', accent: '#7B2639' })
    expect(n).toMatchObject({ bg: '#F3EFE7', text: '#1C1C1C', accent: '#7B2639', changed: [] })
  })
})

describe('свип класса: каждая поверхность держит контракт (репо-страж)', () => {
  it('themeFromBrand резолвит и текст, и акцент', () => {
    const engine = read('lib/carousel/engine.tsx')
    expect(engine).toMatch(/const accent = resolveBrandAccent\(bg,/)
    expect(engine).toMatch(/text: resolveBrandText\(bg,/)
  })
  it('CTA-пилюля сторис не хардкодит белый на акцентной заливке', () => {
    const engine = read('lib/carousel/engine.tsx')
    expect(engine).toContain('backgroundColor: theme.accent, color: theme.onAccent')
    expect(engine).not.toMatch(/backgroundColor: theme\.accent, color: '#fff'/)
  })
  it('FreeCanvas-превью зеркалит серверные поправки (превью = экспорт)', () => {
    const fc = read('components/carousel/FreeCanvas.tsx')
    expect(fc).toContain("from '@/lib/carousel/contrast'")
    expect(fc).toMatch(/resolveBrandText\(brand\.bg, brand\.text\)/)
    expect(fc).toMatch(/resolveBrandAccent\(brand\.bg, brand\.accentColor\)/)
  })
  it('pickPlacement проверяет тёмность брендового текста', () => {
    const pb = read('lib/photoBands.ts')
    expect(pb).toMatch(/contrastRatio\('#FFFFFF', brandDarkText\) >= 4\.5/)
  })
  it('экстрактор нормализует пару ДО записи в кит', () => {
    const an = read('app/api/brand-kit/analyze/route.ts')
    expect(an).toContain('normalizeBrandColors({')
    // Нормализованные значения — единственный источник сохраняемых цветов
    expect(an).toContain('const { bg, text, accent } = norm')
  })
  it('промпт экстрактора требует читаемости text_color на bg_color', () => {
    const an = read('app/api/brand-kit/analyze/route.ts')
    expect(an).toContain('ЧИТАЕТСЯ на bg_color')
  })
})

describe('шрифт сторис — часть фирменного стиля сторис', () => {
  it('экстрактор сохраняет story.font', () => {
    const an = read('app/api/brand-kit/analyze/route.ts')
    expect(an).toMatch(/const story = \{ accentColor: accent, bg, text, bgStyle, \.\.\.\(font \? \{ font \} : \{\}\)/)
  })
  it('StoriesPanel и видео-оверлей берут story.font поверх общего', () => {
    expect(read('components/content/StoriesPanel.tsx')).toContain('font: story.font || d.font')
    expect(read('lib/jobs/runVideoOverlayJob.ts')).toContain('font: story.font || (kit.font as string | undefined)')
  })
})
