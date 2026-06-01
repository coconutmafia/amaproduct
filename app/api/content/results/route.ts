import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET — list this project's generated content with their results metrics
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  // ownership
  const { data: project } = await supabase
    .from('projects').select('id').eq('id', projectId).eq('owner_id', user.id).single()
  if (!project) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data } = await supabase
    .from('content_items')
    .select('id, content_type, title, body_text, day_number, warmup_phase, published_at, reach, reactions, saves, is_approved, created_at')
    .eq('project_id', projectId)
    .order('day_number', { ascending: true })

  return NextResponse.json({ items: data ?? [] })
}

// PATCH — save results for one content item. Strong performers are promoted
// into style_examples so the generator learns what actually worked (closed
// loop: create → publish → measure → improve).
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    itemId?: string; reach?: number; reactions?: number; saves?: number; published_at?: string
  }
  if (!body.itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 })

  // Load item + verify ownership via project
  const { data: item } = await supabase
    .from('content_items')
    .select('id, project_id, content_type, title, body_text, warmup_phase, projects!inner(owner_id)')
    .eq('id', body.itemId)
    .single()
  if (!item || (item.projects as unknown as { owner_id: string }).owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const patch: Record<string, unknown> = {}
  if (body.reach     !== undefined) patch.reach     = Number(body.reach)     || 0
  if (body.reactions !== undefined) patch.reactions = Number(body.reactions) || 0
  if (body.saves     !== undefined) patch.saves     = Number(body.saves)     || 0
  if (body.published_at !== undefined) patch.published_at = body.published_at || null

  const { error } = await supabase.from('content_items').update(patch).eq('id', body.itemId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // ── Learning loop: a post that performed gets saved as a style example,
  // weighted by engagement, so future generations lean on what worked.
  const reactions = Number(body.reactions) || 0
  const reach     = Number(body.reach) || 0
  const bodyText  = (item.body_text as string) || ''
  if (item.content_type === 'post' && bodyText.trim().length > 80 && (reactions > 0 || reach > 0)) {
    const score = Math.min(100, 50 + reactions + Math.floor(reach / 100)) // engagement → priority
    try {
      // de-dupe: one "winner" example per content item title
      const exTitle = `Залетевший пост${item.title ? ` · ${String(item.title).slice(0, 40)}` : ''}`
      await supabase.from('style_examples')
        .delete()
        .eq('project_id', item.project_id)
        .eq('title', exTitle)
      await supabase.from('style_examples').insert({
        project_id:        item.project_id,
        content_type:      'post',
        title:             exTitle,
        body_text:         bodyText,
        warmup_phase:      item.warmup_phase ?? null,
        performance_score: score,
        is_active:         true,
        is_system:         false,
      })
    } catch (e) {
      console.error('[results] promote to style example failed:', e)
    }
  }

  return NextResponse.json({ ok: true })
}
