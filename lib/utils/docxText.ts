// Download a plain-text material as a REAL .docx (Word/Pages/Google Docs open it
// natively). Replaces the old styled-.html download, which the browser just
// re-opened as a web page instead of saving a usable document (tester).

export async function downloadDocx(filename: string, title: string, content: string): Promise<void> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx')

  const paragraphs = [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
    // Empty lines must stay empty paragraphs so the layout survives.
    ...content.split('\n').map((line) => new Paragraph({ children: [new TextRun(line)] })),
  ]

  const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] })
  const blob = await Packer.toBlob(doc)

  // share-first вместо <a download>: blob-скачивание молча умирает в
  // Telegram-webview и iOS-PWA — среде наших мобильных юзеров (20.08)
  const { saveBlobSmart } = await import('@/lib/utils/saveFile')
  await saveBlobSmart(`${filename}.docx`, blob)
}

// openMaterialInBrowser удалён 20.08: window.open глушится Telegram-webview/
// iOS-PWA/Safari-попап-блокером; просмотр материалов живёт в модалке страницы.
