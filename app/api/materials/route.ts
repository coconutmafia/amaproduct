import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const excludeProjectId = searchParams.get('excludeProject')

    // Get all user's projects (except current)
    let projectsQuery = supabase
      .from('projects')
      .select('id, name')
      .eq('owner_id', user.id)
    if (excludeProjectId) {
      projectsQuery = projectsQuery.neq('id', excludeProjectId)
    }
    const { data: projects } = await projectsQuery

    if (!projects || projects.length === 0) {
      return NextResponse.json({ projects: [] })
    }

    const projectIds = projects.map(p => p.id)

    // Get materials from those projects
    const { data: materials } = await supabase
      .from('project_materials')
      .select('id, project_id, material_type, title, processing_status, created_at')
      .in('project_id', projectIds)
      .eq('processing_status', 'ready')
      .order('created_at', { ascending: false })

    // Group by project
    const grouped = projects.map(p => ({
      id: p.id,
      name: p.name,
      materials: (materials || []).filter(m => m.project_id === p.id),
    })).filter(p => p.materials.length > 0)

    return NextResponse.json({ projects: grouped })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    // Verify ownership via project
    const { data: material } = await supabase
      .from('project_materials')
      .select('id, file_url, project_id')
      .eq('id', id)
      .single()

    if (!material) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Check user owns the project
    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', material.project_id)
      .eq('owner_id', user.id)
      .single()

    if (!project) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    // Delete chunks first
    await supabase.from('project_chunks').delete().eq('material_id', id)

    // Delete storage file if exists
    if (material.file_url) {
      const url = material.file_url as string
      const match = url.match(/materials\/(.+)$/)
      if (match) {
        await supabase.storage.from('materials').remove([match[1]])
      }
    }

    // Delete the material record
    const { error } = await supabase.from('project_materials').delete().eq('id', id)
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
