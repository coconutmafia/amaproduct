import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tokenizeStyled, wrapStyled, layoutText, textMetrics, wrapWidthFor, type Measure } from '@/lib/carousel/textLayout'
import { cropGeometry, frameRadius, clampCrop } from '@/lib/carousel/imageGeometry'

// Марина 06.09 (дизайнер команды): «нажимаешь «сохранить картинку» — слайд
// меняется, не сохраняется так, как я его сделала» и «при выборе «Бумага» фон
// чёрный, после сохранения светлый». Корень класса: превью и сервер
// переносили строки РАЗНЫМИ алгоритмами (браузер по глифам, сервер по
// «0,62·размер на символ»), а текстура бумаги в превью ложилась на тёмный
// холст. Теперь строки считает один модуль по реальным ширинам, сервер
// получает их готовыми; геометрия и цвета фона — общие.

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
// Мерилка-заглушка: 10px на символ, пробел 4px (стиль не влияет — проверяем алгоритм).
const measure: Measure = (t) => t === ' ' ? 4 : t.length * 10

describe('lib/carousel/textLayout — один перенос для превью и экспорта', () => {
  it('разметка: **акцент**, __жирное__, *курсив* и переводы строк', () => {
    const t = tokenizeStyled('Она **была** моим __первым__ *преподом*\n\nпо танцам')
    const words = t.filter((x): x is { word: string; style: { em: boolean; bold: boolean; italic: boolean } } => 'word' in x)
    expect(words.map((w) => w.word)).toEqual(['Она', 'была', 'моим', 'первым', 'преподом', 'по', 'танцам'])
    expect(words[1].style).toEqual({ em: true, bold: false, italic: false })
    expect(words[3].style).toEqual({ em: false, bold: true, italic: false })
    expect(words[4].style).toEqual({ em: false, bold: false, italic: true })
    expect(t.filter((x) => 'br' in x)).toHaveLength(2)
  })

  it('перенос по ширине: слова не режутся, строка не длиннее maxWidth', () => {
    const lines = wrapStyled('раз два три четыре пять', 110, measure) // «раз два три» = 98 ≤ 110; «четыре пять» = 104 ≤ 110
    expect(lines.map((l) => l.runs.map((r) => r.text).join(''))).toEqual(['раз два три', 'четыре пять'])
    for (const l of lines) {
      const w = l.runs.reduce((s, r) => s + r.text.replace(/ /g, '').length * 10, 0) + (l.runs.map((r) => r.text).join('').split(' ').length - 1) * 4
      expect(w).toBeLessThanOrEqual(110)
    }
    // Стянуть слово вниз к «вдове» можно только если строка влезает — иначе перелив за край
    const tight = wrapStyled('раз два три четыре пять', 100, measure) // «четыре пять» = 104 > 100 → стянуть нельзя
    expect(tight.map((l) => l.runs.map((r) => r.text).join(''))).toEqual(['раз два три', 'четыре', 'пять'])
  })

  it('одно слово на последней строке — «чтоб такого не было»', () => {
    const lines = wrapStyled('первое второе третье х', 150, measure)
    expect(lines[lines.length - 1].runs.map((r) => r.text).join('').split(' ').length).toBeGreaterThanOrEqual(2)
  })

  it('пустая строка текста = абзацный зазор, краевые и двойные не плодятся', () => {
    const lines = wrapStyled('\n\nабзац один\n\n\n\nабзац два\n\n', 1000, measure)
    expect(lines.map((l) => (l.blank ? '·' : l.runs.map((r) => r.text).join('')))).toEqual(['абзац один', '·', 'абзац два'])
  })

  it('пробеги одного стиля склеиваются с настоящими пробелами; заглавные — до переноса', () => {
    const lines = layoutText('она **была** моим', { maxWidth: 1000, measure, uppercase: true })
    // пробел между стилями остаётся в ПРЕДЫДУЩЕМ пробеге — так же, как он измерялся
    expect(lines[0].runs.map((r) => [r.text, r.em])).toEqual([['ОНА ', false], ['БЫЛА ', true], ['МОИМ', false]])
  })

  it('знак препинания сразу после маркера клеится к слову, а не висит через пробел', () => {
    const lines = layoutText('занятие за **2 500 рублей**.', { maxWidth: 1000, measure })
    expect(lines[0].runs.map((r) => r.text)).toEqual(['занятие за ', '2 500 рублей', '.'])
    // и не отрывается при переносе: «рублей» и «.» уходят на новую строку вместе
    const tight = layoutText('раз два **три**.', { maxWidth: 70, measure }) // «раз два» = 64; +«три.» не влезает
    expect(tight.map((l) => l.runs.map((r) => r.text).join(''))).toEqual(['раз два', 'три.'])
  })

  it('геометрия плашки одна на обе стороны', () => {
    const m = textMetrics(56)
    expect(m.padX).toBe(Math.round(56 * 0.26))
    expect(wrapWidthFor(864, 56, true)).toBe(864 - m.padX * 2)
    expect(wrapWidthFor(864, 56, false)).toBe(864)
  })
})

describe('lib/carousel/imageGeometry — кадрирование одинаково в превью и экспорте', () => {
  it('cover: картинка заполняет рамку, зум растёт от центра, сдвиг в пределах запаса', () => {
    const g = cropGeometry(400, 400, 2, { zoom: 1, x: 0, y: 0 }) // широкая 2:1 в квадрате
    expect(g).toEqual({ iw: 800, ih: 400, left: -200, top: 0 })
    const z = cropGeometry(400, 400, 2, { zoom: 2, x: 1, y: -1 })
    expect(z.iw).toBe(1600); expect(z.left).toBe(-1200); expect(z.top).toBe(0)
    expect(clampCrop({ zoom: 9, x: 5, y: -5 })).toEqual({ zoom: 4, x: 1, y: -1 })
    expect(frameRadius(300, 200, 0.5)).toBe(100)
    expect(frameRadius(300, 200, undefined)).toBe(0)
  })
})

describe('движок и превью пользуются одним и тем же', () => {
  const engine = read('lib/carousel/engine.tsx')
  const canvas = read('components/carousel/FreeCanvas.tsx')
  it('сервер рендерит готовые строки (FreeLines) и не переносит их заново', () => {
    expect(engine).toContain('function FreeLines')
    expect(engine).toMatch(/Array\.isArray\(b\.lines\) && b\.lines\.length > 0\s*\?\s*<FreeLines/)
    expect(engine).toContain("whiteSpace: 'pre'")
    expect(engine).toContain('textMetrics(size)')
  })
  it('превью строит строки тем же модулем и шлёт их в экспорт', () => {
    expect(canvas).toContain('layoutText(b.text')
    expect(canvas).toContain('lines: layoutBlock(b, brand)')
    expect(canvas).toContain('function PreviewLines')
    expect(canvas).toContain('makeMeasure(')
    expect(read('lib/carousel/measureClient.ts')).toContain("fontKerning = 'none'")
  })
  it('«Бумага»: текстура поверх цвета фона и в превью, и на сервере', () => {
    expect(canvas).toMatch(/backgroundColor: eff\.bg, backgroundImage: "url\('\/textures\/paper\.png'\)"/)
    expect(engine).toMatch(/backgroundColor: theme\.bg[\s\S]{0,400}theme\.bgStyle === 'paper' && theme\.paperUrl/)
    // exportBrandFor отдаёт серверу тот же bg, что рисует превью
    expect(canvas).toMatch(/v\.bgMode === 'paper' \? \{ \.\.\.base, bg: eff\.bg/)
  })
  it('функции Марины: заглавные, свой цвет, шрифт блока, выравнивание справа, слово жирным/курсивом, картинка (форма/прозрачность/обрезка), направляющие', () => {
    for (const s of ['uppercase: !sel.uppercase', "type=\"color\"", 'Шрифт бренда', "'right'", "wrapSelection(sel, '__')", "wrapSelection(sel, '*')", "radius: r || undefined", 'opacity: Number(e.target.value)', 'crop: { zoom: 1.2, x: 0, y: 0 }', 'guides.v &&', 'bgColor: e.target.value']) {
      expect(canvas, s).toContain(s)
    }
    for (const s of ['b.uppercase', 'fontFamilyOf(b.font)', 'frameRadius(w, h, b.radius)', 'cropGeometry(w, h', 'opacity,']) expect(engine, s).toContain(s)
  })
  it('редактор: черновик в localStorage, «Сохранить оформление», скачивание через share-sheet', () => {
    const ed = read('components/carousel/StoryEditor.tsx')
    expect(ed).toContain('ama_story_editor_')
    expect(ed).toContain("fetch('/api/story-layouts'")
    expect(ed).toContain('saveBlobSmart(')
    expect(ed).toContain('prepareFontsFor(slide, brand)')
    expect(read('supabase/migrations/048_story_layouts.sql')).toContain('create table if not exists story_layouts')
    const api = read('app/api/story-layouts/route.ts')
    expect(api).toContain("from('story_layouts')")
    expect(api).toContain('needsMigration')
  })
})
