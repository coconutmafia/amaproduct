import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Material types that are "evergreen" — done once, reused across products/launches
const EVERGREEN_TYPES = [
  'audience_survey', 'interview_transcript', 'audience_research',
  'interview_transcription', // from new research feature
  'meanings_map',
  'unpacking_map',
  'tone_of_voice', 'tov',
  'blog_lines',
  'competitors',
  'marketing_strategy',
]

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const excludeProjectId = searchParams.get('excludeProject')
    const mode = searchParams.get('mode') // 'global' | null

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
      return NextResponse.json({ projects: [], global: [] })
    }

    const projectIds = projects.map(p => p.id)

    // Get materials from those projects
    let materialsQuery = supabase
      .from('project_materials')
      .select('id, project_id, material_type, title, processing_status, created_at')
      .in('project_id', projectIds)
      .eq('processing_status', 'ready')
      .order('created_at', { ascending: false })

    const { data: materials } = await materialsQuery

    if (mode === 'global') {
      // Return evergreen materials flat, with project name attached
      const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]))
      const globalMaterials = (materials || [])
        .filter(m => EVERGREEN_TYPES.includes(m.material_type))
        .map(m => ({ ...m, project_name: projectMap[m.project_id] ?? '' }))
      return NextResponse.json({ global: globalMaterials, projects: [] })
    }

    // Default: group by project
    const grouped = projects.map(p => ({
      id: p.id,
      name: p.name,
      materials: (materials || []).filter(m => m.project_id === p.id),
    })).filter(p => p.materials.length > 0)

    return NextResponse.json({ projects: grouped, global: [] })
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

    // Recalculate project completeness so the stored score stays in sync
    // with the dynamic score shown inside the project (same formula).
    const { data: remaining } = await supabase
      .from('project_materials')
      .select('material_type')
      .eq('project_id', material.project_id)
      .eq('processing_status', 'ready')
    const types = new Set(remaining?.map(m => m.material_type) || [])
    let score = 0
    if (types.has('tone_of_voice'))       score += 25
    if (types.has('unpacking_map'))       score += 15
    if (types.has('cases_reviews'))       score += 15
    if (types.has('marketing_strategy'))  score += 15
    if (types.has('funnel_description'))  score += 10
    if (types.has('audience_research'))   score += 10
    if (types.has('blog_lines'))          score += 10
    if (types.has('competitors'))         score += 5
    if (types.has('product_description')) score += 5
    await supabase
      .from('projects')
      .update({ completeness_score: Math.min(100, score) })
      .eq('id', material.project_id)

    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
