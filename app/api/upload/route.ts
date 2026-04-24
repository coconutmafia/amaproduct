import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// 60 секунд — для векторизации через OpenAI
export const maxDuration = 60

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

      // PDF — извлекаем текст через pdf-parse v1
      if (name.endsWith('.pdf') || file.type === 'application/pdf') {
        try {
          // pdf-parse v1: default export is a function(Buffer) => Promise<{text, numpages}>
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string; numpages: number }>
          const bytes = await file.arrayBuffer()
          const result = await pdfParse(Buffer.from(bytes))
          rawContent = result.text
          if (!rawContent || rawContent.trim().length < 10) {
            return NextResponse.json({
              error: 'PDF не содержит читаемого текста. Возможно, это скан. Скопируй текст вручную и вставь в поле ниже.',
            }, { status: 400 })
          }
        } catch {
          return NextResponse.json({
            error: 'Не удалось прочитать PDF. Попробуй скопировать текст и вставить в поле ниже.',
          }, { status: 400 })
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

      // Excel (.xlsx / .xls) — извлекаем все листы как текст через SheetJS
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        try {
          const XLSX = await import('xlsx')
          const arrayBuf = await file.arrayBuffer()
          // SheetJS требует Uint8Array, не ArrayBuffer
          const workbook = XLSX.read(new Uint8Array(arrayBuf), { type: 'array' })
          const lines: string[] = []
          for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName]
            const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
            if (csv.trim()) {
              lines.push(`=== Лист: ${sheetName} ===`)
              lines.push(csv)
            }
          }
          rawContent = lines.join('\n\n')
          if (!rawContent.trim()) {
            return NextResponse.json({
              error: 'Excel-файл пустой или не содержит текстовых данных',
            }, { status: 400 })
          }
        } catch (xlsxErr) {
          console.error('xlsx parse error:', xlsxErr)
          return NextResponse.json({
            error: 'Не удалось прочитать Excel-файл. Попробуйте сохранить как .csv и загрузить заново.',
          }, { status: 400 })
        }
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
        const { data: urlData } = supabase.storage
          .from('materials')
          .getPublicUrl(storagePath)
        fileUrl = urlData.publicUrl
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

    // Сохраняем чанки
    const chunkTable = isSystemVault ? 'knowledge_chunks' : 'project_chunks'
    const idField    = isSystemVault ? 'vault_id'         : 'material_id'

    for (let i = 0; i < chunks.length; i++) {
      await supabase.from(chunkTable).insert({
        [idField]:   materialId,
        ...(isSystemVault ? {} : { project_id: projectId }),
        chunk_index: i,
        chunk_text:  chunks[i],
        embedding:   embeddings[i],
        metadata:    { chunk_index: i, total_chunks: chunks.length },
      })
    }

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

  const types = new Set(materials?.map(m => m.material_type) || [])
  let score = 0
  if (types.has('tone_of_voice'))       score += 25
  if (types.has('unpacking_map'))       score += 15
  if (types.has('cases_reviews'))       score += 15
  if (types.has('marketing_strategy'))  score += 15
  if (types.has('funnel_description'))  score += 10
  if (types.has('audience_research'))   score += 10
  if (types.has('competitors'))         score += 5
  if (types.has('product_description')) score += 5

  await supabase
    .from('projects')
    .update({ completeness_score: Math.min(100, score) })
    .eq('id', projectId)
}
