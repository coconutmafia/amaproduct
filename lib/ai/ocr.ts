import { anthropic, MODEL } from '@/lib/ai/client'

// OCR / text extraction from images and image-only ("scanned") PDFs via Claude
// vision. The materials upload path (app/api/upload/route.ts) extracts a text
// LAYER from PDFs/DOCX/XLSX — but review screenshots, case studies, and photos
// (which the «Кейсы и отзывы» section explicitly invites) have no text layer:
// each PDF page is a single image, and image files aren't parsed at all. Those
// used to fail with «PDF не содержит читаемого текста» / «Нет текста». Here we
// send the raw file to Claude, which reads the pixels and returns the text.
//
// Claude accepts PDF documents (base64, ≤32MB) and images (jpeg/png/webp/gif)
// natively — see the claude-api PDF/vision docs.

const OCR_SYSTEM = `Ты распознаёшь текст с изображений и сканов: скриншоты отзывов клиентов, кейсы,
фото документов, карточки «до/после», а также СКРИНШОТЫ ОПРОСОВ И СТАТИСТИКИ из Instagram
(опросы в сторис, викторины, шкалы, «вопрос-ответ», охваты, реакции). Верни ТОЛЬКО распознанный
текст — дословно, сохраняя структуру (абзацы, списки, имена авторов отзывов). Не добавляй свои
комментарии, заголовки вроде «Вот текст» и markdown-заборы. Если на файле несколько отдельных
отзывов/блоков — раздели их пустой строкой.

ОПРОСЫ И СТАТИСТИКА. Если на скриншоте опрос, голосование или цифры — обязательно сохрани ЦИФРЫ и
их привязку к вариантам, иначе данные теряют смысл. Формат: сначала строка вопроса, затем каждый
вариант с его результатом, по одному в строке:
Вопрос: Что мешает начать танцевать?
- Нет времени — 62% (124 голоса)
- Стесняюсь — 28% (56 голосов)
Если рядом есть охваты/просмотры/реакции — выпиши их отдельной строкой («Охват: 1240, ответов: 180»).
Проценты, доли и абсолютные числа переноси ТОЧНО как на картинке, ничего не округляй и не выдумывай:
чего не видно — не пиши.

Если осмысленного текста нет вообще — верни пустую строку.`

export type OcrImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** Map a filename/MIME to a Claude-supported image media type, or null if unsupported. */
export function imageMediaType(name: string, mime?: string | null): OcrImageMediaType | null {
  const n = name.toLowerCase()
  if (mime === 'image/png' || n.endsWith('.png')) return 'image/png'
  if (mime === 'image/jpeg' || /\.(jpe?g)$/.test(n)) return 'image/jpeg'
  if (mime === 'image/webp' || n.endsWith('.webp')) return 'image/webp'
  if (mime === 'image/gif' || n.endsWith('.gif')) return 'image/gif'
  return null
}

async function runOcr(block:
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: OcrImageMediaType; data: string } },
): Promise<string> {
  const resp = await anthropic.messages.create({
    model:      MODEL,
    max_tokens: 8000,
    system:     OCR_SYSTEM,
    // The document/image block must come BEFORE the text instruction.
    messages: [{ role: 'user', content: [block, { type: 'text', text: 'Распознай и верни весь текст из этого файла.' }] }],
  })
  return resp.content.map(b => (b.type === 'text' ? b.text : '')).join('\n').trim()
}

/** Extract text from an image-only (scanned) PDF by reading its pages as images. */
export function ocrPdf(buffer: Buffer): Promise<string> {
  return runOcr({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } })
}

/** Extract text from an image file (review screenshot, photo of a document, etc.). */
export function ocrImage(buffer: Buffer, mediaType: OcrImageMediaType): Promise<string> {
  return runOcr({ type: 'image', source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') } })
}
