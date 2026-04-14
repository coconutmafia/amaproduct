import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
  'video/mp4',
  'video/quicktime',
  'image/jpeg',
  'image/png',
  'image/webp',
]

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
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

    let fileUrl: string | null = null
    let fileType: string | null = null
    let rawContent = textContent || null

    // Upload file if provided
    if (file) {
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: 'File too large (max 50MB)' }, { status: 400 })
      }

      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
      const storagePath = isSystemVault
        ? `knowledge-vault/${fileName}`
        : `projects/${projectId}/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('materials')
        .upload(storagePath, buffer, { contentType: file.type })

      if (!uploadError) {
        const { data: urlData } = supabase.storage.from('materials').getPublicUrl(storagePath)
        fileUrl = urlData.publicUrl
        fileType = file.name.split('.').pop()?.toLowerCase() || null
      }
    }

    // Create material record
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
          processing_status: 'pending',
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
          processing_status: rawContent ? 'processing' : 'pending',
        })
        .select()
        .single()

      if (error) throw error
      materialId = material.id
    }

    // Process in background (simplified - in production use queue)
    if (rawContent) {
      processContent(materialId, rawContent, projectId, isSystemVault, user.id)
        .catch(console.error)
    }

    return NextResponse.json({ materialId, processingStatus: 'processing' })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}

async function processContent(
  materialId: string,
  text: string,
  projectId: string,
  isSystemVault: boolean,
  adminId: string
) {
  const supabase = await createClient()

  try {
    const { splitIntoChunks } = await import('@/lib/ai/rag')
    const chunks = splitIntoChunks(text, 512, 50)

    // Create embeddings via OpenAI
    const embeddingsRes = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: chunks,
      }),
    })

    if (!embeddingsRes.ok) throw new Error('Embeddings failed')

    const embeddingsData = await embeddingsRes.json()
    const embeddings = embeddingsData.data.map((d: { embedding: number[] }) => d.embedding)

    const table = isSystemVault ? 'knowledge_chunks' : 'project_chunks'
    const idField = isSystemVault ? 'vault_id' : 'material_id'

    for (let i = 0; i < chunks.length; i++) {
      await supabase.from(table).insert({
        [idField]: materialId,
        ...(isSystemVault ? {} : { project_id: projectId }),
        chunk_index: i,
        chunk_text: chunks[i],
        embedding: embeddings[i],
        metadata: { chunk_index: i, total_chunks: chunks.length },
      })
    }

    // Update status
    const table2 = isSystemVault ? 'knowledge_vault' : 'project_materials'
    await supabase.from(table2).update({ processing_status: 'ready' }).eq('id', materialId)

    // Recalculate completeness
    if (!isSystemVault) {
      await recalculateCompleteness(projectId)
    }
  } catch (error) {
    const table2 = isSystemVault ? 'knowledge_vault' : 'project_materials'
    await supabase.from(table2).update({ processing_status: 'error' }).eq('id', materialId)
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

  const types = new Set(materials?.map((m) => m.material_type) || [])

  let score = 0
  if (types.has('tone_of_voice')) score += 25
  if (types.has('unpacking_map')) score += 15
  if (types.has('cases_reviews')) score += 15
  if (types.has('marketing_strategy')) score += 15
  if (types.has('funnel_description')) score += 10
  if (types.has('audience_research')) score += 10
  if (types.has('competitors')) score += 5
  if (types.has('product_description')) score += 5

  await supabase.from('projects').update({ completeness_score: Math.min(100, score) }).eq('id', projectId)
}
