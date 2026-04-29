import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { materialIds, targetProjectId } = await request.json() as {
      materialIds: string[]
      targetProjectId: string
    }

    if (!materialIds?.length || !targetProjectId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Verify user owns the target project
    const { data: targetProject } = await supabase
      .from('projects')
      .select('id')
      .eq('id', targetProjectId)
      .eq('owner_id', user.id)
      .single()

    if (!targetProject) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    // Fetch source materials (verify user owns the source projects)
    const { data: sourceMaterials } = await supabase
      .from('project_materials')
      .select('*, projects!inner(owner_id)')
      .in('id', materialIds)
      .eq('projects.owner_id', user.id)

    if (!sourceMaterials?.length) {
      return NextResponse.json({ error: 'No materials found' }, { status: 404 })
    }

    const imported: string[] = []
    const errors: string[] = []

    for (const source of sourceMaterials) {
      // Create new material record in target project (same file_url, same content)
      const { data: newMaterial, error: insertError } = await supabase
        .from('project_materials')
        .insert({
          project_id: targetProjectId,
          material_type: source.material_type,
          title: source.title,
          file_url: source.file_url,
          file_type: source.file_type,
          file_size: source.file_size,
          content_text: source.content_text,
          processing_status: source.processing_status,
          chunk_count: source.chunk_count,
        })
        .select('id')
        .single()

      if (insertError || !newMaterial) {
        errors.push(source.title)
        continue
      }

      // Copy chunks too (for RAG to work immediately)
      const { data: sourceChunks } = await supabase
        .from('project_chunks')
        .select('content, chunk_index, metadata, embedding')
        .eq('material_id', source.id)

      if (sourceChunks && sourceChunks.length > 0) {
        const chunksToInsert = sourceChunks.map(c => ({
          project_id: targetProjectId,
          material_id: newMaterial.id,
          content: c.content,
          chunk_index: c.chunk_index,
          metadata: c.metadata,
          embedding: c.embedding,
        }))
        await supabase.from('project_chunks').insert(chunksToInsert)
      }

      imported.push(newMaterial.id)
    }

    // Return new material records for immediate UI update
    const { data: newMaterials } = await supabase
      .from('project_materials')
      .select('id, material_type, title, processing_status')
      .in('id', imported)

    return NextResponse.json({
      imported: imported.length,
      errors: errors.length,
      materials: newMaterials || [],
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
