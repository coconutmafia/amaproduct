import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeCompleteness } from '@/lib/completeness'

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

    // Delete storage file if exists. file_url now stores the bare storage
    // path (private bucket — no more permanent public URL to parse a path out
    // of). Use the ADMIN client: ownership was already verified above, and the
    // user-session client's own DELETE previously failed this SILENTLY
    // (unchecked error) leaving orphaned files in storage forever. Matches the
    // admin-client pattern already used for storage in video/overlay.
    if (material.file_url) {
      const admin = createAdminClient()
      const { error: removeErr } = await admin.storage.from('materials').remove([material.file_url as string])
      if (removeErr) console.error('[materials DELETE] storage remove failed:', removeErr.message, material.file_url)
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
    const score = computeCompleteness(remaining?.map(m => m.material_type) || [])
    await supabase
      .from('projects')
      .update({ completeness_score: score })
      .eq('id', material.project_id)

    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
