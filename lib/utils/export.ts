import type { ContentItem } from '@/types'

export async function copyToClipboard(content: ContentItem): Promise<void> {
  const text = content.body_text || ''
  await navigator.clipboard.writeText(text)
}

export async function exportToPDF(content: ContentItem): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF()

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(content.title || 'Контент', 20, 20)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)

  const text = content.body_text || ''
  const lines = doc.splitTextToSize(text, 170)
  doc.text(lines, 20, 35)

  if (content.hashtags?.length) {
    const hashtagText = content.hashtags.join(' ')
    const hashtagLines = doc.splitTextToSize(hashtagText, 170)
    const yPos = 35 + lines.length * 6 + 10
    doc.setTextColor(100, 100, 200)
    doc.text(hashtagLines, 20, yPos)
  }

  doc.save(`${content.title || 'content'}.pdf`)
}

export async function exportToDOCX(content: ContentItem): Promise<void> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx')

  const paragraphs = [
    new Paragraph({
      text: content.title || 'Контент',
      heading: HeadingLevel.HEADING_1,
    }),
    ...(content.body_text || '').split('\n').map(
      (line) => new Paragraph({ children: [new TextRun(line)] })
    ),
  ]

  if (content.hashtags?.length) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: content.hashtags.join(' '),
            color: '6464C8',
          }),
        ],
      })
    )
  }

  const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] })
  const blob = await Packer.toBlob(doc)

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${content.title || 'content'}.docx`
  a.click()
  URL.revokeObjectURL(url)
}

export async function exportContentPlanToXLSX(items: ContentItem[]): Promise<void> {
  const XLSX = await import('xlsx')

  const data = items.map((item) => ({
    День: item.day_number,
    Тип: item.content_type,
    Фаза: item.warmup_phase,
    Тема: item.title,
    CTA: item.cta,
    Статус: item.is_approved ? 'Одобрен' : 'Черновик',
  }))

  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Контент-план')
  XLSX.writeFile(wb, 'content-plan.xlsx')
}
