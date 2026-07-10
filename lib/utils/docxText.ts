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

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.docx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

// Open a material in a new browser tab as a clean, readable page — the «Посмотреть»
// action. Nothing is saved to disk.
export function openMaterialInBrowser(title: string, content: string): void {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
       max-width:720px;margin:0 auto;padding:28px 20px;color:#1a1a1a;line-height:1.6;font-size:16px;background:#fff}
  h1{font-size:22px;font-weight:700;margin:0 0 6px}
  .meta{color:#888;font-size:13px;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #eee}
  .content{white-space:pre-wrap}
  @media (prefers-color-scheme: dark){ body{background:#111;color:#eee} .meta{color:#999;border-color:#333} }
</style></head><body>
<h1>${esc(title)}</h1>
<div class="meta">Материал проекта · AMA</div>
<div class="content">${esc(content)}</div>
</body></html>`
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
