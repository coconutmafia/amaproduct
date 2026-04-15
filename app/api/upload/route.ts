import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Увеличиваем таймаут до 60 секунд — нужно для векторизации через OpenAI
export const maxDuration = 60

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_TEXT_TYPES = ['text/plain', 'text/markdown', 'text/csv']

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const formData = await request.formData()
    const projectId = formData.get('projectId') as string
    const title = formData.get('title') as string
    const materialType = formData.get('materialType') as string
    const textContent = formData.get('textContent') as string | null
    const file = formData.get('file') as File | null
    const isSystemVault = formData.get('isSystemVault') === 'true'

    if (!title?.trim()) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }

    let rawContent = textContent?.trim() || null
    let fileUrl: string | null = null
    let fileType: string | null = null

    // Загрузка файла — только текстовые форматы обрабатываем
    if (file && file.size > 0) {
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: 'Файл слишком большой (макс 10MB)' }, { status: 400 })
      }

      // Для текстовых файлов — читаем содержимое
      if (ALLOWED_TEXT_TYPES.includes(file.type) || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
        rawContent = await file.text()
      }

      // Загружаем в Storage
      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)
      const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const storagePath = isSystemVault
        ? `knowledge-vault/${safeName}`
        : `projects/${projectId}/${safeName}`

      const { error: uploadError } = await supabase.storage
        .from('materials')
        .upload(storagePath, buffer, { contentType: file.type })

      if (!uploadError) {
        const { data: urlData } = supabase.storage.from('materials').getPublicUrl(storagePath)
        fileUrl = urlData.publicUrl
        fileType = file.name.split('.').pop()?.toLowerCase() || null
      }
    }

    if (!rawContent) {
      return NextResponse.json({ error: 'Нет текстового содержимого для обработки' }, { status: 400 })
    }

    // Сохраняем запись в статусе 'processing'
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
      if (error) throw error
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
      if (error) throw error
      materialId = material.id
    }

    // Обрабатываем СИНХРОННО — разбиваем на чанки и векторизуем
    try {
      await processContent(materialId, rawContent, projectId, isSystemVault)
    } catch (procError) {
      console.error('Processing error:', procError)
      // Статус уже обновится в error внутри processContent
      return NextResponse.json({
        materialId,
        processingStatus: 'error',
        warning: 'Материал сохранён, но векторизация не удалась. Проверьте OPENAI_API_KEY.',
      })
    }

    return NextResponse.json({ materialId, processingStatus: 'ready' })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Ошибка загрузки' }, { status: 500 })
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

    // Ограничиваем размер текста чтобы не превысить лимиты OpenAI
    const truncated = text.slice(0, 100000)
    const chunks = splitIntoChunks(truncated, 512, 50)

    // Батчами по 20 чанков — лимит OpenAI на batch
    const BATCH_SIZE = 20
    const allEmbeddings: number[][] = []

    for (let b = 0; b < chunks.length; b += BATCH_SIZE) {
      const batch = chunks.slice(b, b + BATCH_SIZE)
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
        throw new Error(`OpenAI error: ${err}`)
      }

      const data = await res.json()
      allEmbeddings.push(...data.data.map((d: { embedding: number[] }) => d.embedding))
    }

    // Сохраняем чанки с векторами
    const chunkTable = isSystemVault ? 'knowledge_chunks' : 'project_chunks'
    const idField = isSystemVault ? 'vault_id' : 'material_id'

    for (let i = 0; i < chunks.length; i++) {
      await supabase.from(chunkTable).insert({
        [idField]: materialId,
        ...(isSystemVault ? {} : { project_id: projectId }),
        chunk_index: i,
        chunk_text: chunks[i],
        embedding: allEmbeddings[i],
        metadata: { chunk_index: i, total_chunks: chunks.length },
      })
    }

    // Обновляем статус на ready
    await supabase.from(statusTable).update({ processing_status: 'ready' }).eq('id', materialId)

    // Пересчитываем completeness для проекта
    if (!isSystemVault && projectId) {
      await recalculateCompleteness(projectId)
    }
  } catch (error) {
    await supabase.from(statusTable).update({ processing_status: 'error' }).eq('id', materialId)
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
  if (types.has('tone_of_voice')) score += 25
  if (types.has('unpacking_map')) score += 15
  if (types.has('cases_reviews')) score += 15
  if (types.has('marketing_strategy')) score += 15
  if (types.has('funnel_description')) score += 10
  if (types.has('audience_research')) score += 10
  if (types.has('competitors')) score += 5
  if (types.has('product_description')) score += 5

  await supabase.from('projects')
    .update({ completeness_score: Math.min(100, score) })
    .eq('id', projectId)
}
