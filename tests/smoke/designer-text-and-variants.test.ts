import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FONTS, FONT_HAS_ITALIC, FONT_KEYS } from '@/lib/fonts'

// ─────────────────────────────────────────────────────────────────────────────
// Просьбы Марины 24.08 («оформить пост с аишкой»): (1) «весь текст жирный,
// нельзя убрать, нет курсива» → у текстовых блоков дизайнера есть начертание
// (Ж/К), курсив честный — только там, где есть italic-файл; (2) «иконки
// генерирует одну и без выбора» → генерация даёт варианты на выбор.
// ─────────────────────────────────────────────────────────────────────────────

describe('начертание текста в дизайнере (Ж/К)', () => {
  it('FONT_HAS_ITALIC согласован с реально зарегистрированными italic-файлами', () => {
    for (const k of FONT_KEYS) {
      const hasItalicFile = FONTS[k].files.some((f) => f.style === 'italic')
      expect(hasItalicFile, `${k}: карта курсивов врёт относительно файлов`).toBe(FONT_HAS_ITALIC[k])
    }
  })
  it('у Montserrat и PT Serif есть курсив (обычный и жирный)', () => {
    for (const k of ['montserrat', 'pt-serif'] as const) {
      const italics = FONTS[k].files.filter((f) => f.style === 'italic').map((f) => f.weight)
      expect(italics).toContain(400)
      expect(italics).toContain(700)
    }
  })
  it('движок рендерит weight/italic свободных блоков (не фикс-жирным)', () => {
    const src = readFileSync(join(process.cwd(), 'lib/carousel/engine.tsx'), 'utf8')
    expect(src).toContain("b.weight === 'normal' ? 400 : 800")
    expect(src).toContain('italic={!!b.italic}')
    expect(src).toMatch(/weight\?: 'normal' \| 'bold'/)
  })
  it('редактор: кнопки Ж/К, экспорт переносит weight/italic, К скрыт без italic-файла', () => {
    const src = readFileSync(join(process.cwd(), 'components/carousel/FreeCanvas.tsx'), 'utf8')
    expect(src).toContain('aria-label="жирный"')
    expect(src).toContain('aria-label="курсив"')
    expect(src).toContain('FONT_HAS_ITALIC[(brand.font')
    expect(src).toContain('weight: b.weight, italic: b.italic')
  })
})

describe('AI-картинки: варианты на выбор', () => {
  it('роут принимает count (1..3) и отдаёт urls[]', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/ai/generate-image/route.ts'), 'utf8')
    expect(src).toContain('Math.max(1, Math.min(3')
    expect(src).toContain('n: count')
    expect(src).toContain('url: urls[0], urls')
  })
  it('редактор просит 3 варианта и показывает грид выбора', () => {
    const src = readFileSync(join(process.cwd(), 'components/carousel/FreeCanvas.tsx'), 'utf8')
    expect(src).toContain('count: 3')
    expect(src).toContain('applyAiVariant')
    expect(src).toContain('Выбери вариант')
  })
})
