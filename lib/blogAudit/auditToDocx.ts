import type { AuditResult, AuditBlockResult } from '@/lib/blogAudit/runBlogAudit'
import { MAX_SCORE } from '@/lib/blogAudit/checklist'
import { zoneBreakdown } from '@/lib/blogAudit/auditToText'

// Оформленный .docx разбора — то же, что человек видит на экране, а не сплошной
// текст. Просьба владельца 27.08: «скачивается простыней, сделай как на сайте».
// Разбор пересылают маркетологу и открывают с телефона, поэтому документ должен
// читаться сам по себе: зоны, карточки блоков, цветные маркеры пунктов.
//
// Цвета повторяют экран (ScoreDot / ZoneLegend в BlogAuditDialog):
//   2 балла — зелёный, 1 — янтарный, 0 — красный, не оценивалось — замок.
const GREEN = '22C55E'
const AMBER = 'F59E0B'
const RED = 'F87171'
const GREY = 'CBD5E1'
const INK = '1F2937'
const MUTED = '6B7280'
const BRAND = 'D44E7E'

export async function buildAuditDocx(
  result: AuditResult,
  dateLabel: string,
  consultUrl: string,
) {
  const d = await import('docx')
  const {
    Document, Paragraph, TextRun, Table, TableRow, TableCell,
    WidthType, ShadingType, BorderStyle, AlignmentType, ExternalHyperlink,
  } = d

  const green = Math.max(0, result.scored)
  const grey = Math.max(0, MAX_SCORE - result.assessableMax)
  const yellow = Math.max(0, result.assessableMax - result.scored)
  const zones = zoneBreakdown(result)

  const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as const
  const noBorders = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER }
  const cardBorder = (color: string) => ({
    top:    { style: BorderStyle.SINGLE, size: 6, color },
    bottom: { style: BorderStyle.SINGLE, size: 6, color },
    left:   { style: BorderStyle.SINGLE, size: 6, color },
    right:  { style: BorderStyle.SINGLE, size: 6, color },
  })

  const text = (t: string, o: { bold?: boolean; color?: string; size?: number } = {}) =>
    new TextRun({ text: t, bold: o.bold, color: o.color ?? INK, size: o.size ?? 20 })
  const p = (runs: InstanceType<typeof TextRun>[], o: { spacing?: number; indent?: number } = {}) =>
    new Paragraph({
      children: runs,
      spacing: { after: o.spacing ?? 80 },
      ...(o.indent ? { indent: { left: o.indent } } : {}),
    })
  const gap = () => new Paragraph({ children: [], spacing: { after: 120 } })

  // Карточка = таблица из одной ячейки: в Word это единственный способ получить
  // рамку с заливкой вокруг произвольного содержимого.
  const card = (children: InstanceType<typeof Paragraph>[], opts: { fill?: string; border?: string } = {}) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: cardBorder(opts.border ?? 'E5E7EB'),
      rows: [new TableRow({
        children: [new TableCell({
          children,
          margins: { top: 160, bottom: 160, left: 200, right: 200 },
          ...(opts.fill ? { shading: { type: ShadingType.CLEAR, fill: opts.fill, color: 'auto' } } : {}),
        })],
      })],
    })

  // ── Полоса 100 баллов: три ячейки шириной ровно в свои доли ────────────────
  const barCell = (width: number, fill: string) => new TableCell({
    children: [new Paragraph({ children: [text(' ', { size: 8 })] })],
    width: { size: Math.max(1, width), type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.CLEAR, fill, color: 'auto' },
    borders: noBorders,
  })
  const scoreBar = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders,
    rows: [new TableRow({
      children: [
        ...(green > 0 ? [barCell(green, GREEN)] : []),
        ...(grey > 0 ? [barCell(grey, GREY)] : []),
        ...(yellow > 0 ? [barCell(yellow, AMBER)] : []),
      ],
    })],
  })

  const zoneLine = (color: string, value: number, title: string, desc: string) =>
    p([
      text('●  ', { color, bold: true }),
      text(`${value} — ${title}`, { bold: true }),
      text(`  ${desc}`, { color: MUTED, size: 18 }),
    ])

  const blockCardContent = (b: AuditBlockResult) => {
    const head = b.assessableMax > 0 ? `${b.scored}/${b.assessableMax}` : 'на консультации'
    const headColor = b.assessableMax > 0
      ? (b.scored / b.assessableMax >= 0.5 ? GREEN : AMBER)
      : MUTED
    const lines: InstanceType<typeof Paragraph>[] = [
      new Paragraph({
        children: [text(b.title, { bold: true, size: 22 }), text(`     ${head}`, { bold: true, color: headColor })],
        spacing: { after: 120 },
      }),
    ]
    for (const it of b.items) {
      const dot = it.score === null ? '🔒' : '●'
      const dotColor = it.score === null ? MUTED : it.score === 2 ? GREEN : it.score === 1 ? AMBER : RED
      lines.push(p([
        text(`${dot}  `, { color: dotColor, bold: true }),
        text(it.label, { color: it.assessable ? INK : MUTED }),
      ], { spacing: 40 }))
      if (it.note) lines.push(p([text(it.note, { color: MUTED, size: 18 })], { spacing: 100, indent: 240 }))
    }
    return lines
  }

  // Блоки идут В ДВЕ КОЛОНКИ, как на экране (просьба владельца 27.08): одна
  // таблица на пару блоков, каждая ячейка — карточка с рамкой. Нечётный
  // последний блок занимает свою колонку, соседняя остаётся пустой без рамки —
  // иначе Word рисует «пустую карточку».
  const cellCard = (b: AuditBlockResult | null) => new TableCell({
    children: b ? blockCardContent(b) : [new Paragraph({ children: [] })],
    width: { size: 50, type: WidthType.PERCENTAGE },
    margins: { top: 160, bottom: 160, left: 200, right: 200 },
    borders: b ? cardBorder('E5E7EB') : noBorders,
  })

  const blocksGrid = () => {
    const rows: InstanceType<typeof TableRow>[] = []
    for (let i = 0; i < result.blocks.length; i += 2) {
      rows.push(new TableRow({
        children: [cellCard(result.blocks[i]), cellCard(result.blocks[i + 1] ?? null)],
      }))
    }
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      // Рамки рисуют сами ячейки; у таблицы-сетки своих быть не должно,
      // иначе колонки склеятся в один общий прямоугольник.
      borders: noBorders,
      columnWidths: [4680, 4680],
      rows,
    })
  }

  const children: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = []

  // ── Шапка ─────────────────────────────────────────────────────────────────
  children.push(new Paragraph({
    children: [text('Экспресс-диагностика блога', { bold: true, size: 34 })],
    spacing: { after: 40 },
  }))
  children.push(p([text('Оцени, насколько хорошо продаёт твой Instagram', { color: MUTED, size: 20 })]))
  children.push(p([text(`@${result.handle}`, { bold: true, color: BRAND }), text(`   ·   ${dateLabel}`, { color: MUTED, size: 18 })]))
  children.push(gap())

  // ── Диагноз + как сложились 100 баллов ────────────────────────────────────
  children.push(card([
    p([text(result.diagnosis, { bold: true, size: 22 })]),
    p([text(
      `Мы разобрали шапку и последние посты @${result.handle} по чек-листу на 100 баллов. Сторис, актуальные и то, куда ведёт ссылка, автоматически увидеть нельзя — эти баллы вынесены отдельно.`,
      { color: MUTED, size: 18 },
    )], { spacing: 160 }),
  ]))
  children.push(gap())
  children.push(scoreBar)
  children.push(gap())
  children.push(zoneLine(GREEN, green, 'собрано', 'критерии диагностики выполнены'))
  children.push(zoneLine(GREY, grey, 'нужна оценка эксперта', 'автоматически проверить невозможно'))
  children.push(zoneLine(AMBER, yellow, 'зона роста', 'критерии не выполнены — это можно улучшить'))
  children.push(gap())

  // ── Что это значит для конкретного блога ──────────────────────────────────
  const zoneRows: Array<[string, string, string[]]> = [
    [AMBER, 'Зона роста', zones.yellow],
    [GREY, 'Нужен эксперт', zones.grey],
    [GREEN, 'Собрано', zones.green],
  ]
  const meaningful = zoneRows.filter(([, , list]) => list.length > 0)
  if (meaningful.length > 0) {
    children.push(card([
      p([text(`Что это значит для @${result.handle}`, { bold: true })]),
      ...meaningful.map(([color, title, list]) =>
        p([text('●  ', { color, bold: true }), text(`${title}: `, { bold: true }), text(list.join(', '), { color: MUTED })])),
    ], { fill: 'F9FAFB' }))
    children.push(gap())
  }

  // ── Вердикт ───────────────────────────────────────────────────────────────
  if (result.summary) {
    children.push(card([p([text(result.summary)])], { fill: 'F3F4F6' }))
    children.push(gap())
  }

  // ── Что усилить в первую очередь ──────────────────────────────────────────
  if (result.topGaps.length > 0) {
    children.push(card([
      p([text('Что усилить в первую очередь', { bold: true, color: 'B45309' })]),
      ...result.topGaps.map(g => p([text('→  ', { color: 'B45309', bold: true }), text(g)])),
    ], { fill: 'FFFBEB', border: 'FDE68A' }))
    children.push(gap())
  }

  // ── Разбор по блокам ──────────────────────────────────────────────────────
  children.push(p([text('Разбор по блокам', { bold: true, size: 26 })], { spacing: 160 }))
  children.push(blocksGrid())
  children.push(gap())

  if (result.notAssessableCount > 0) {
    const locked = result.blocks.filter(b => b.items.some(it => !it.assessable)).map(b => b.title)
    children.push(p([text(
      `🔒 ${result.notAssessableCount} пунктов${locked.length ? ` (${locked.join(', ')})` : ''} обсуждаются на консультации — их не считать автоматически с поверхности профиля.`,
      { color: MUTED, size: 18 },
    )]))
    children.push(gap())
  }

  // ── Призыв на консультацию ────────────────────────────────────────────────
  children.push(card([
    new Paragraph({
      children: [text('Хочешь полную стратегию по блогу?', { bold: true, color: 'FFFFFF', size: 24 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [text('На бесплатной консультации маркетолог разберёт актуальные, визуал и воронку и покажет, как привести блог в порядок, чтобы он продавал.', { color: 'FFFFFF', size: 18 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new ExternalHyperlink({
        children: [new TextRun({ text: 'Записаться на бесплатную консультацию →', bold: true, color: 'FFFFFF', underline: {} })],
        link: consultUrl,
      })],
    }),
  ], { fill: BRAND, border: BRAND }))

  return new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 20, color: INK } } } },
    sections: [{ properties: {}, children }],
  })
}

// Скачивание: сборка + упаковка + сохранение. Отдельно от buildAuditDocx,
// чтобы саму вёрстку можно было проверить тестом без браузера.
export async function downloadAuditDocx(
  result: AuditResult,
  dateLabel: string,
  filename: string,
  consultUrl: string,
): Promise<void> {
  const { Packer } = await import('docx')
  const doc = await buildAuditDocx(result, dateLabel, consultUrl)
  const blob = await Packer.toBlob(doc)
  // share-first: blob-скачивание молча умирает в Telegram-webview и iOS-PWA
  const { saveBlobSmart } = await import('@/lib/utils/saveFile')
  await saveBlobSmart(`${filename}.docx`, blob)
}
