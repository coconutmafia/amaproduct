import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { captureException } from '@/lib/sentry'
import { buildXlsxWorkbook, type XlsxSheet } from '@/lib/utils/xlsxTable'
import { audienceResearchToAoa, audienceResearchToPivotAoa, meaningsMapToAoa } from '@/lib/researchTables'

export const dynamic = 'force-dynamic'

// GET /api/materials/[id]/download — отдаёт материал ФАЙЛОМ с сервера.
//
// ЗАЧЕМ (инцидент 20.08, Полина Назарова): скачивание было клиентским
// (blob + <a download>), просмотр — window.open ПОСЛЕ await. Оба паттерна
// молча умирают во встроенных браузерах (сайт открыт по ссылке из Telegram —
// WKWebView без обработчика download), в iOS-PWA «на рабочем столе» и в
// Safari с блокировкой попапов («с компа вообще не открывается»). Обычная
// навигация на серверный URL с Content-Disposition работает ВЕЗДЕ: браузер/
// webview сам показывает «Сохранить/Поделиться».
//
// Формат повторяет клиентскую логику страницы материалов:
//   audience_research → .xlsx книга «Касдевы» (строка = участник) + «Карта
//     смыслов» (если в проекте есть готовая) — эталон урока, два листа;
//   meanings_map → .xlsx один лист со слитыми ячейками категорий;
//   остальное → .docx (настоящий Word-файл, как раньше).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params

    // RLS session-клиента сам ограничивает доступ проектами пользователя
    const { data: material } = await supabase
      .from('project_materials')
      .select('id, raw_content, material_type, title, project_id')
      .eq('id', id)
      .single()
    if (!material) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const content = String(material.raw_content ?? '')
    if (!content.trim()) {
      return NextResponse.json({ error: 'В материале пока нет содержимого' }, { status: 422 })
    }

    const title = String(material.title || 'Материал')
    const safe = title.replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().slice(0, 80) || 'material'

    const attachment = (filename: string) =>
      // filename= — ASCII-фолбэк, filename*= — настоящее кириллическое имя (RFC 5987)
      `attachment; filename="download.${filename.split('.').pop()}"; filename*=UTF-8''${encodeURIComponent(filename)}`

    // ── Табличные материалы → .xlsx ─────────────────────────────────────────
    let sheets: XlsxSheet[] | null = null
    if (material.material_type === 'meanings_map') {
      const aoa = meaningsMapToAoa(content)
      if (aoa.length > 1) sheets = [{ name: 'Карта смыслов', aoa, mergeRepeats: [0, 1] }]
    } else if (material.material_type === 'audience_research') {
      const aoa = audienceResearchToAoa(content)
      if (aoa.length > 1) {
        sheets = []
        const pivot = audienceResearchToPivotAoa(content)
        if (pivot.length > 1) sheets.push({ name: 'Касдевы', aoa: pivot })
        else sheets.push({ name: 'Кастдевы', aoa })
        // Карта смыслов проекта вторым листом — эталон урока (2 листа)
        const { data: mapMat } = await supabase
          .from('project_materials')
          .select('raw_content')
          .eq('project_id', material.project_id)
          .eq('material_type', 'meanings_map')
          .eq('processing_status', 'ready')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (mapMat?.raw_content) {
          const mapAoa = meaningsMapToAoa(String(mapMat.raw_content))
          if (mapAoa.length > 1) sheets.push({ name: 'Карта смыслов', aoa: mapAoa, mergeRepeats: [0, 1] })
        }
      }
    }

    if (sheets && sheets.length > 0) {
      const wb = await buildXlsxWorkbook(sheets)
      const buf = await wb.xlsx.writeBuffer()
      return new NextResponse(Buffer.from(buf as ArrayBuffer), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': attachment(`${safe}.xlsx`),
          'Cache-Control': 'no-store',
        },
      })
    }

    // ── Текстовые материалы → .docx ─────────────────────────────────────────
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx')
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
          ...content.split('\n').map((line) => new Paragraph({ children: [new TextRun(line)] })),
        ],
      }],
    })
    const docBuf = await Packer.toBuffer(doc)
    return new NextResponse(Buffer.from(docBuf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': attachment(`${safe}.docx`),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    await captureException(error, { where: 'materials download' })
    return NextResponse.json({ error: 'Не удалось скачать материал — попробуй ещё раз' }, { status: 500 })
  }
}
