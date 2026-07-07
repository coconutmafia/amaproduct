import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeCompleteness } from '@/lib/completeness'
import { ocrPdf, ocrImage, imageMediaType } from '@/lib/ai/ocr'

// 120 секунд — векторизация через OpenAI + возможный OCR скана/картинки через Claude vision
export const maxDuration = 120

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const formData = await request.formData()
    const projectId   = formData.get('projectId')   as string
    const title       = formData.get('title')       as string
    const materialType = formData.get('materialType') as string
    const textContent = formData.get('textContent') as string | null
    const file        = formData.get('file')        as File | null
    const isSystemVault = formData.get('isSystemVault') === 'true'

    if (!title?.trim()) {
      return NextResponse.json({ error: 'Введите название' }, { status: 400 })
    }

    let rawContent = textContent?.trim() || null
    let fileUrl: string | null = null
    let fileType: string | null = null

    // ── Обработка файла ──────────────────────────────────────────
    if (file && file.size > 0) {
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: 'Файл слишком большой (макс 20MB)' }, { status: 400 })
      }

      fileType = file.name.split('.').pop()?.toLowerCase() || null
      const name = file.name.toLowerCase()

      // Текстовые форматы — читаем напрямую
      if (
        file.type.startsWith('text/') ||
        name.endsWith('.txt') ||
        name.endsWith('.md') ||
        name.endsWith('.csv')
      ) {
        rawContent = await file.text()
      }

      // PDF — сначала пробуем извлечь текстовый СЛОЙ через pdf-parse v1.
      if (name.endsWith('.pdf') || file.type === 'application/pdf') {
        const pdfBuf = Buffer.from(await file.arrayBuffer())
        try {
          // pdf-parse v1: default export is a function(Buffer) => Promise<{text, numpages}>
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string; numpages: number }>
          const result = await pdfParse(pdfBuf)
          rawContent = result.text
        } catch {
          rawContent = null
        }
        // Скан / PDF-картинка (без текстового слоя) — читаем страницы как изображения
        // через Claude vision. Раздел «Кейсы и отзывы» приглашает грузить скриншоты,
        // а у них текстового слоя нет — раньше это падало на «PDF не содержит текста».
        if (!rawContent || rawContent.trim().length < 10) {
          try {
            rawContent = await ocrPdf(pdfBuf)
          } catch (e) {
            console.error('[upload] pdf OCR failed:', e)
          }
          if (!rawContent || rawContent.trim().length < 10) {
            return NextResponse.json({
              error: 'Не удалось распознать текст в PDF. Если это фото/скан — загрузи его как изображение (JPG/PNG), или вставь текст через «Добавить текст».',
            }, { status: 400 })
          }
        }
      }

      // Word (.docx) — извлекаем текст через mammoth
      if (name.endsWith('.docx') || name.endsWith('.doc')) {
        try {
          const mammoth = await import('mammoth')
          const bytes = await file.arrayBuffer()
          const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
          rawContent = result.value
        } catch {
          return NextResponse.json({
            error: 'Для загрузки Word-файлов скопируйте текст и вставьте его в поле "Текст"',
          }, { status: 400 })
        }
      }

      // Excel (.xlsx / .xls) — извлекаем все листы как текст через SheetJS.
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        try {
          const XLSX = await import('xlsx')
          const arrayBuf = await file.arrayBuffer()
          // SheetJS требует Uint8Array, не ArrayBuffer
          const workbook = XLSX.read(new Uint8Array(arrayBuf), { type: 'array' })
          const lines: string[] = []
          let cellChars = 0 // реальные символы В ЯЧЕЙКАХ (без разделителей)
          for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName]
            const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
            const meaningful = csv.replace(/[,;"\s]/g, '')
            if (meaningful.length > 0) {
              cellChars += meaningful.length
              lines.push(`=== Лист: ${sheetName} ===`)
              lines.push(csv)
            }
          }
          rawContent = lines.join('\n\n')
          // «Карту смыслов» часто делают в Excel как СХЕМУ / текстовые блоки /
          // картинку — а это живёт ВНЕ ячеек, поэтому чтение ячеек находит мало
          // или ничего, хотя человек «у себя видит». Даём понятное сообщение
          // вместо тихого сохранения пустого материала, который не дойдёт до AI.
          if (cellChars < 15) {
            return NextResponse.json({
              error: 'В Excel почти нет текста в ЯЧЕЙКАХ. Если карта смыслов сделана как схема, текстовые блоки или картинка — Excel хранит их отдельно от ячеек, и прочитать не получается. Сохрани данные обычной таблицей (текст в ячейках), экспортируй в CSV, или вставь текст через «Добавить текст» ниже.',
            }, { status: 400 })
          }
        } catch (xlsxErr) {
          console.error('xlsx parse error:', xlsxErr)
          return NextResponse.json({
            error: 'Не удалось прочитать Excel-файл (возможно, он защищён паролем или это не настоящий .xlsx). Сохрани как .csv или вставь текст через «Добавить текст».',
          }, { status: 400 })
        }
      }

      // Изображения (скриншоты отзывов, кейсы, фото документов) — распознаём текст
      // через Claude vision. Раньше картинки вообще не обрабатывались и падали на
      // «Нет текста для обработки». Оригинал файла всё равно сохраняется в Storage ниже.
      const imgType = imageMediaType(name, file.type)
      if (!rawContent && imgType) {
        try {
          rawContent = await ocrImage(Buffer.from(await file.arrayBuffer()), imgType)
        } catch (e) {
          console.error('[upload] image OCR failed:', e)
          return NextResponse.json({
            error: 'Не удалось распознать текст на изображении. Возможно, оно слишком большое — сожми фото и попробуй снова, или вставь текст через «Добавить текст».',
          }, { status: 400 })
        }
        if (!rawContent || rawContent.trim().length < 10) {
          return NextResponse.json({
            error: 'На изображении не найден читаемый текст. Загрузи скриншот отзыва с текстом или вставь текст через «Добавить текст».',
          }, { status: 400 })
        }
      }

      // Audio/video have no text extraction here → without this they'd fall
      // through to the generic «Нет текста для обработки» 400. Give a clear path
      // to the transcription flow instead of a confusing error (esp. on drag&drop,
      // which bypasses the file-picker's accept filter).
      if (!rawContent && (file.type.startsWith('audio/') || file.type.startsWith('video/') ||
          /\.(mp3|m4a|wav|ogg|oga|opus|aac|flac|mp4|mov|m4v|webm)$/i.test(name))) {
        return NextResponse.json({
          error: 'Аудио и видео здесь не расшифровываются. Загрузи запись созвона/интервью в разделе «Исследование» — там сработает автоматическая расшифровка, и текст попадёт в материалы.',
        }, { status: 400 })
      }

      // Загружаем файл в Supabase Storage
      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)
      const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const storagePath = isSystemVault
        ? `knowledge-vault/${safeName}`
        : `projects/${projectId}/${safeName}`

      const { error: uploadError } = await supabase.storage
        .from('materials')
        .upload(storagePath, buffer, { contentType: file.type })

      if (uploadError) {
        console.error('Storage upload error:', uploadError)
        // Продолжаем без файла — главное текст
      } else {
        // 'materials' is a PRIVATE bucket (may hold sensitive business/client
        // data) — store the bare storage PATH, not a permanent public URL.
        // The file is served later via a short-lived signed URL, minted
        // on-demand by GET /api/materials/[id]/file after an ownership check.
        fileUrl = storagePath
      }
    }

    // ── Проверяем что есть хоть какой-то текст ───────────────────
    if (!rawContent || rawContent.trim().length < 10) {
      return NextResponse.json({
        error: 'Нет текста для обработки. Вставьте текст в поле ниже или загрузите .txt файл',
      }, { status: 400 })
    }

    // ── Сохраняем запись ─────────────────────────────────────────
    let materialId: string

    if (isSystemVault) {
      const { data: item, error } = await supabase
        .from('knowledge_vault')
        .insert({
          admin_id: user.id,
          title: title.trim(),
          content_type: materialType,
          raw_content: rawContent,
          file_url: fileUrl,
          file_type: fileType,
          processing_status: 'processing',
        })
        .select()
        .single()
      if (error) throw new Error(error.message || JSON.stringify(error))
      materialId = item.id
    } else {
      const { data: material, error } = await supabase
        .from('project_materials')
        .insert({
          project_id: projectId,
          material_type: materialType,
          title: title.trim(),
          raw_content: rawContent,
          file_url: fileUrl,
          file_type: fileType,
          processing_status: 'processing',
        })
        .select()
        .single()
      if (error) throw new Error(error.message || JSON.stringify(error))
      materialId = material.id
    }

    // ── Векторизация (синхронно) ──────────────────────────────────
    try {
      await processContent(materialId, rawContent, projectId, isSystemVault)
      return NextResponse.json({ materialId, processingStatus: 'ready' })
    } catch (procError) {
      console.error('Vectorization error:', procError)
      return NextResponse.json({
        materialId,
        processingStatus: 'error',
        warning: 'Материал сохранён, но векторизация не удалась. Проверь OPENAI_API_KEY в Vercel.',
      })
    }
  } catch (error) {
    console.error('Upload error:', error)
    const msg = error instanceof Error
      ? error.message
      : (typeof error === 'object' && error !== null && 'message' in error)
        ? String((error as { message: unknown }).message)
        : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function processContent(
  materialId: string,
  text: string,
  projectId: string,
  isSystemVault: boolean
) {
  const supabase = await createClient()
  const statusTable = isSystemVault ? 'knowledge_vault' : 'project_materials'

  try {
    const { splitIntoChunks } = await import('@/lib/ai/rag')

    // Не больше 80 000 символов за раз
    const content = text.slice(0, 80000)
    const chunks = splitIntoChunks(content, 512, 50)

    if (chunks.length === 0) throw new Error('Нет чанков')

    // Батчи по 20 — лимит OpenAI
    const BATCH = 20
    const embeddings: number[][] = []

    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH)
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: batch }),
      })

      if (!res.ok) {
        const err = await res.text()
        throw new Error(`OpenAI error ${res.status}: ${err}`)
      }

      const data = await res.json()
      embeddings.push(...data.data.map((d: { embedding: number[] }) => d.embedding))
    }

    // Сохраняем чанки. ВАЖНО: проверяем ошибку вставки — раньше она глоталась,
    // и когда RLS отклонял запись в knowledge_chunks (не было insert-политики),
    // векторизация «успешно» завершалась с 0 чанков (методология не доходила).
    const chunkTable = isSystemVault ? 'knowledge_chunks' : 'project_chunks'
    const idField    = isSystemVault ? 'vault_id'         : 'material_id'

    const rows = chunks.map((chunk_text, i) => ({
      [idField]:   materialId,
      ...(isSystemVault ? {} : { project_id: projectId }),
      chunk_index: i,
      chunk_text,
      embedding:   embeddings[i],
      metadata:    { chunk_index: i, total_chunks: chunks.length },
    }))
    const { error: chunkErr } = await supabase.from(chunkTable).insert(rows)
    if (chunkErr) throw new Error(`chunk insert failed: ${chunkErr.message}`)

    await supabase
      .from(statusTable)
      .update({ processing_status: 'ready' })
      .eq('id', materialId)

    if (!isSystemVault && projectId) {
      await recalculateCompleteness(projectId)
    }
  } catch (error) {
    await supabase
      .from(statusTable)
      .update({ processing_status: 'error' })
      .eq('id', materialId)
    throw error
  }
}

async function recalculateCompleteness(projectId: string) {
  const supabase = await createClient()
  const { data: materials } = await supabase
    .from('project_materials')
    .select('material_type')
    .eq('project_id', projectId)
    .eq('processing_status', 'ready')

  const score = computeCompleteness(materials?.map(m => m.material_type) || [])

  // Auto-computed field, not a user-editable project setting — an editor
  // (not just the owner) can trigger this via an upload, and projects'
  // session-client UPDATE policy is owner-only (migration 025). Admin client
  // bypasses that deliberately, same reasoning as video/overlay's output write.
  const admin = createAdminClient()
  await admin
    .from('projects')
    .update({ completeness_score: score })
    .eq('id', projectId)
}
