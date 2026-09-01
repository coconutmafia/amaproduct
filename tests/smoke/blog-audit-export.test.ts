import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToBuffer } from '@react-pdf/renderer'
import { zoneBreakdown } from '@/lib/blogAudit/auditToText'
import { buildAuditPdfDoc, stripEmoji } from '@/lib/blogAudit/auditToPdf'
import { CHECKLIST } from '@/lib/blogAudit/checklist'
import type { AuditResult } from '@/lib/blogAudit/runBlogAudit'

// 27.08 выгрузка переехала с плоского текста на оформленный .docx («скачивается
// простынёй, сделай как на сайте»). 01.09 — с .docx на PDF: разбор пересылают в
// Telegram, там docx открывает Quick Look (iOS) и разваливает вёрстку — файл,
// правильный в Word, у получателя выглядел колонкой в одну букву. PDF рендерится
// одинаково в любом вьюере. Требования к содержанию не менялись с текстовой
// версии — проверки те же, теперь они смотрят внутрь PDF.

const result: AuditResult = {
  handle: 'anette_eyn',
  diagnosis: 'Страница рабочая, но есть потери в доверии/CTA/контенте',
  summary: 'Блог обаятельный, но структура не выстроена на продажу.',
  topGaps: ['Нет соцдоказательств: опыт, ученики, регалии', 'Не описан результат для ученика'],
  scored: 46,
  assessableMax: 74,
  score100: 62,
  score10: 6.2,
  notAssessableCount: 13,
  blocks: [
    {
      key: 'audience', title: 'ЦА и смыслы', scored: 7, assessableMax: 10,
      items: [
        { label: 'Понятно ли, для какой конкретной аудитории блог?', assessable: true, score: 2, note: 'Да — девушки, dancehall, Новосибирск' },
        { label: 'Видно ли, какие боли аудитории закрывает блог?', assessable: true, score: 1, note: 'Частично — боли намёками, 2/4/6🍋' },
      ],
    },
    {
      key: 'highlights', title: 'Актуальные', scored: 0, assessableMax: 0,
      items: [
        { label: 'Есть ли актуальное «Обо мне / мой путь»?', assessable: false, score: null, note: 'Не видно из профиля — разберём на консультации' },
      ],
    },
  ],
}

const CONSULT = 'https://t.me/probe'

// Рендерим ОДИН раз на весь файл: это полный проход через react-pdf с реальными
// шрифтами из public/fonts — если шрифт пропал или вёрстка падает, упадёт тут.
let cache: { buf: Buffer; text: string } | null = null
async function pdfParts() {
  if (cache) return cache
  const buf = await renderToBuffer(buildAuditPdfDoc(result, '17 июля 2026', CONSULT))
  // pdf-parse v1: прямой импорт lib-файла, потому что корневой index.js в ESM
  // (без module.parent) уходит в debug-режим и читает несуществующий файл.
  // @ts-expect-error — у глубокого импорта pdf-parse нет типов, форма задана кастом ниже
  const mod = await import('pdf-parse/lib/pdf-parse.js') as { default: (b: Buffer) => Promise<{ text: string; numpages: number }> }
  const pdfParse = mod.default
  const parsed = await pdfParse(buf)
  cache = { buf, text: parsed.text.replace(/\s+/g, ' ') }
  return cache
}

// Обход дерева React-элементов вёрстки — структурные проверки (цвета, колонки,
// ссылка) делаем по дереву, потому что содержимое PDF сжато и в сыром буфере
// цветов не найти.
type El = { type?: unknown; props?: Record<string, unknown> } | string | number | null | undefined
function walk(el: El, visit: (el: { type?: unknown; props: Record<string, unknown> }) => void) {
  if (el == null || typeof el === 'string' || typeof el === 'number') return
  const node = el as { type?: unknown; props?: Record<string, unknown> }
  if (!node.props) return
  visit(node as { type?: unknown; props: Record<string, unknown> })
  const kids = node.props.children
  for (const k of Array.isArray(kids) ? kids.flat() : [kids]) walk(k as El, visit)
}
function collectStyles(doc: ReturnType<typeof buildAuditPdfDoc>): Array<Record<string, unknown>> {
  const styles: Array<Record<string, unknown>> = []
  walk(doc, ({ props }) => {
    const s = props.style
    for (const st of Array.isArray(s) ? s : [s]) if (st && typeof st === 'object') styles.push(st as Record<string, unknown>)
  })
  return styles
}

describe('выгрузка разбора в PDF', () => {
  it('это валидный PDF — формат с одинаковым рендером в любом вьюере', async () => {
    const { buf } = await pdfParts()
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it('кириллица не потерялась при встраивании шрифта', async () => {
    const { text } = await pdfParts()
    expect(text).toContain('Экспресс-диагностика блога')
  })

  it('содержит хендл, дату и диагноз', async () => {
    const { text } = await pdfParts()
    expect(text).toContain('@anette_eyn')
    expect(text).toContain('17 июля 2026')
    expect(text).toContain('Страница рабочая')
  })

  it('раскладывает 100 баллов на три зоны и они сходятся в 100', async () => {
    const { text } = await pdfParts()
    // green=46, grey=100-74=26, yellow=74-46=28 → 46+26+28 = 100
    expect(text).toContain('46 баллов · собрано')
    expect(text).toContain('26 баллов · нужна оценка эксперта')
    expect(text).toContain('28 баллов · зона роста')
  })

  it('полоса баллов нарисована цветами экрана с долями зон', () => {
    const doc = buildAuditPdfDoc(result, '17 июля 2026', CONSULT)
    const styles = collectStyles(doc)
    const seg = (color: string) => styles.find(s => s.backgroundColor === color && typeof s.width === 'string')
    expect(seg('#22C55E')?.width, 'зелёная часть').toBe('46%')
    expect(seg('#CBD5E1')?.width, 'серая часть').toBe('26%')
    expect(seg('#FBBF24')?.width, 'янтарная часть').toBe('28%')
  })

  it('блоки идут В ДВЕ КОЛОНКИ, как на экране', () => {
    const doc = buildAuditPdfDoc(result, '17 июля 2026', CONSULT)
    let pairRows = 0
    walk(doc, ({ props }) => {
      const kids = props.children
      if (!Array.isArray(kids)) return
      const flat = kids.flat().filter(Boolean) as Array<{ props?: { block?: unknown } }>
      if (flat.length === 2 && flat.some(k => k.props && 'block' in k.props)) pairRows++
    })
    expect(pairRows, 'нет ни одной строки из двух карточек').toBeGreaterThan(0)
  })

  it('поясняет, что для ЭТОГО блога в каждой зоне (просьба Августы)', async () => {
    const { text } = await pdfParts()
    expect(text).toContain('Собрано: ЦА и смыслы')
    expect(text).toContain('Нужен эксперт: Актуальные')
  })

  it('пункты идут как ВОПРОС → ОТВЕТ (главное требование владельца)', async () => {
    const { text } = await pdfParts()
    expect(text).toContain('Понятно ли, для какой конкретной аудитории блог?')
    // ответ идёт СРАЗУ за вопросом, а не где-то в документе
    expect(text).toMatch(/Видно ли, какие боли аудитории закрывает блог\?\s*Частично — боли намёками/)
  })

  it('блок без машинной оценки помечен «на консультации», а не нулём', async () => {
    const { text } = await pdfParts()
    expect(text).toContain('Актуальные')
    expect(text).toContain('на консультации')
    expect(text).not.toContain('0/0')
  })

  it('включает вердикт и что усилить', async () => {
    const { text } = await pdfParts()
    expect(text).toContain('Блог обаятельный')
    expect(text).toContain('Что усилить в первую очередь')
    expect(text).toContain('Нет соцдоказательств')
  })

  it('ссылка на консультацию ведёт туда же, куда кнопка на экране', () => {
    const doc = buildAuditPdfDoc(result, '17 июля 2026', CONSULT)
    let link: unknown = null
    walk(doc, ({ props }) => { if (props.src) link = props.src })
    expect(link).toBe(CONSULT)
  })

  it('CTA залит фирменным градиентом (.gradient-accent), а не серым', () => {
    const doc = buildAuditPdfDoc(result, '17 июля 2026', CONSULT)
    const stops: string[] = []
    walk(doc, ({ props }) => { if (typeof props.stopColor === 'string') stops.push(props.stopColor) })
    expect(stops).toEqual(['#F5A84A', '#E86BA0', '#D44E7E'])
  })

  it('эмодзи из заметок LLM вычищены (в Inter нет глифов — были бы квадраты)', async () => {
    const { text } = await pdfParts()
    expect(text).not.toContain('🍋')
    expect(text).toContain('2/4/6')
  })

  it('шрифт с кириллицей лежит в репозитории — не в CDN', () => {
    for (const w of [400, 600, 700]) {
      const buf = readFileSync(`${process.cwd()}/public/fonts/Inter-${w}.ttf`)
      expect(buf.subarray(0, 4).readUInt32BE(0), `Inter-${w}.ttf не TTF`).toBe(0x00010000)
    }
  })

  it('кнопка на экране скачивает именно PDF (не docx): страж по исходнику', () => {
    const src = readFileSync(`${process.cwd()}/components/projects/BlogAuditDialog.tsx`, 'utf8')
    expect(src).toContain("import('@/lib/blogAudit/auditToPdf')")
    expect(src).not.toContain('auditToDocx')
  })
})

describe('stripEmoji — чистит эмодзи, но не трогает вёрсточные символы', () => {
  it('убирает эмодзи и вариационные селекторы', () => {
    expect(stripEmoji('2/4/6🍋')).toBe('2/4/6')
    expect(stripEmoji('готово ✅ и 🔒 замок')).toBe('готово и замок')
  })
  it('оставляет стрелки, маркеры и типографику', () => {
    expect(stripEmoji('боль → решение · итог ●')).toBe('боль → решение · итог ●')
    expect(stripEmoji('«кавычки» и — тире')).toBe('«кавычки» и — тире')
  })
})

describe('zoneBreakdown — какие блоки в какой зоне', () => {
  it('блок с половиной баллов и выше → «собрано», иначе → «зона роста»', () => {
    const z = zoneBreakdown(result)
    expect(z.green).toContain('ЦА и смыслы')   // 7/10 = 70%
    expect(z.yellow).not.toContain('ЦА и смыслы')
  })

  it('блок, который нечего оценивать машинно → «нужен эксперт», а не 0 баллов', () => {
    const z = zoneBreakdown(result)
    expect(z.grey).toEqual(['Актуальные'])
    expect(z.yellow).not.toContain('Актуальные')
  })
})

describe('чек-лист — все пункты сформулированы вопросами', () => {
  it('каждый label заканчивается знаком вопроса', () => {
    const bad = CHECKLIST.flatMap(b => b.items.filter(i => !i.label.trim().endsWith('?')).map(i => i.label))
    expect(bad).toEqual([])
  })

  it('чек-лист остался 10×5 = 50 пунктов (100 баллов)', () => {
    expect(CHECKLIST).toHaveLength(10)
    expect(CHECKLIST.every(b => b.items.length === 5)).toBe(true)
  })
})
