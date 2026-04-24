import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/style-bank?projectId=xxx&contentType=post
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    const contentType = searchParams.get('contentType')

    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

    // Verify project ownership
    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single()

    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    let query = supabase
      .from('style_examples')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (contentType) {
      query = query.eq('content_type', contentType)
    }

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ examples: data || [] })
  } catch (error) {
    console.error('Style bank GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch style examples' }, { status: 500 })
  }
}

// POST /api/style-bank — save a new style example
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { projectId, contentType, title, bodyText, warmupPhase, tags, sourceContentItemId, performanceScore } = body

    if (!projectId || !bodyText || !contentType) {
      return NextResponse.json({ error: 'projectId, contentType and bodyText required' }, { status: 400 })
    }

    // Verify project ownership
    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single()

    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const { data, error } = await supabase
      .from('style_examples')
      .insert({
        project_id: projectId,
        content_type: contentType,
        title: title || null,
        body_text: bodyText,
        warmup_phase: warmupPhase || null,
        tags: tags || null,
        performance_score: performanceScore || 0,
        source_content_item_id: sourceContentItemId || null,
        is_active: true,
      })
      .select()
      .single()

    if (error) throw error

    // Also mark the source content item as approved
    if (sourceContentItemId) {
      await supabase
        .from('content_items')
        .update({ is_approved: true, body_text: bodyText })
        .eq('id', sourceContentItemId)
    }

    return NextResponse.json({ example: data })
  } catch (error) {
    console.error('Style bank POST error:', error)
    return NextResponse.json({ error: 'Failed to save style example' }, { status: 500 })
  }
}

// DELETE /api/style-bank?id=xxx
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    // Soft delete — set is_active = false
    const { error } = await supabase
      .from('style_examples')
      .update({ is_active: false })
      .eq('id', id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Style bank DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete style example' }, { status: 500 })
  }
}

// PATCH /api/style-bank — update performance score or tags
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { id, performanceScore, tags } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const updates: Record<string, unknown> = {}
    if (performanceScore !== undefined) updates.performance_score = performanceScore
    if (tags !== undefined) updates.tags = tags

    const { data, error } = await supabase
      .from('style_examples')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ example: data })
  } catch (error) {
    console.error('Style bank PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update style example' }, { status: 500 })
  }
}
