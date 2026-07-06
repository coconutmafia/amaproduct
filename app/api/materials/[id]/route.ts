import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/materials/[id] — returns raw_content for a material owned by the user
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params

    // Fetch material and verify ownership via project
    const { data: material } = await supabase
      .from('project_materials')
      .select('id, raw_content, material_type, title, project_id')
      .eq('id', id)
      .single()

    if (!material) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({
      id: material.id,
      raw_content: material.raw_content,
      material_type: material.material_type,
      title: material.title,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// PATCH /api/materials/[id] — updates raw_content for a blog_lines material
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const body = await request.json() as { raw_content?: string }
    if (typeof body.raw_content !== 'string') {
      return NextResponse.json({ error: 'Missing raw_content' }, { status: 400 })
    }

    // Fetch material to verify ownership
    const { data: material } = await supabase
      .from('project_materials')
      .select('id, project_id, material_type')
      .eq('id', id)
      .single()

    if (!material) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Update raw_content — RLS (project_materials_write, editor+) is the
    // access boundary here; the session client enforces it directly.
    const { error } = await supabase
      .from('project_materials')
      .update({ raw_content: body.raw_content })
      .eq('id', id)

    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
