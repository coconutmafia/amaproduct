import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isRlsError, READ_ONLY_MESSAGE } from '@/lib/projects/access'

// Results = the learning loop: create → publish → measure → improve.
// Covers BOTH content sources:
//   'plan'  — content_items (контент-план)
//   'saved' — saved_content («Готовое», chat-saved library — the voice-learning
//             source in rag.ts, now weighted by these metrics)

// GET — list this project's generated content with their results metrics
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const { data: project } = await supabase
    .from('projects').select('id').eq('id', projectId).single()
  if (!project) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: plan } = await supabase
    .from('content_items')
    .select('id, content_type, title, body_text, day_number, warmup_phase, published_at, reach, reactions, saves, is_approved, created_at')
    .eq('project_id', projectId)
    .order('day_number', { ascending: true })

  // «Готовое» — metric columns may not exist until migration 023; degrade
  // gracefully to the plan-only list rather than 500 the whole page.
  let saved: Array<Record<string, unknown>> = []
  try {
    const { data, error } = await supabase
      .from('saved_content')
      .select('id, content_type, title, body, created_at, reach, reactions, saves, published_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(100)
    if (!error && data) saved = data
  } catch { /* pre-migration */ }

  const items = [
    ...(plan ?? []).map(i => ({ ...i, source: 'plan' as const })),
    ...saved.map(s => ({
      id: s.id,
      source: 'saved' as const,
      content_type: (s.content_type as string) || 'post',
      title: s.title,
      body_text: s.body,
      day_number: null,
      warmup_phase: null,
      published_at: s.published_at ?? null,
      reach: s.reach ?? null,
      reactions: s.reactions ?? null,
      saves: s.saves ?? null,
      created_at: s.created_at,
    })),
  ]

  return NextResponse.json({ items })
}

// PATCH — save results for one item (plan or saved). Strong performers are
// promoted into style_examples so the generator learns what actually worked.
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    itemId?: string; source?: 'plan' | 'saved'
    reach?: number; reactions?: number; saves?: number; published_at?: string
  }
  if (!body.itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 })
  const source = body.source === 'saved' ? 'saved' : 'plan'

  // Load item + verify ownership; normalize to a common shape
  let projectId: string | null = null
  let contentType = 'post'
  let title: string | null = null
  let bodyText = ''
  let warmupPhase: string | null = null

  if (source === 'plan') {
    // RLS (content_items_select, viewer+) already scopes this read; the
    // .update() below is separately gated by content_items_write (editor+).
    const { data: item } = await supabase
      .from('content_items')
      .select('id, project_id, content_type, title, body_text, warmup_phase')
      .eq('id', body.itemId)
      .single()
    if (!item) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    projectId = item.project_id as string
    contentType = (item.content_type as string) || 'post'
    title = item.title as string | null
    bodyText = (item.body_text as string) || ''
    warmupPhase = (item.warmup_phase as string | null) ?? null
  } else {
    const { data: item } = await supabase
      .from('saved_content')
      .select('id, user_id, project_id, content_type, title, body')
      .eq('id', body.itemId)
      .single()
    if (!item || item.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    projectId = item.project_id as string | null
    contentType = (item.content_type as string) || 'post'
    title = item.title as string | null
    bodyText = (item.body as string) || ''
  }

  const patch: Record<string, unknown> = {}
  if (body.reach     !== undefined) patch.reach     = Number(body.reach)     || 0
  if (body.reactions !== undefined) patch.reactions = Number(body.reactions) || 0
  if (body.saves     !== undefined) patch.saves     = Number(body.saves)     || 0
  if (body.published_at !== undefined) patch.published_at = body.published_at || null

  const table = source === 'plan' ? 'content_items' : 'saved_content'
  const { error } = await supabase.from(table).update(patch).eq('id', body.itemId)
  if (error) {
    if (isRlsError(error)) return NextResponse.json({ error: READ_ONLY_MESSAGE }, { status: 403 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── Learning loop: a TEXT piece that performed becomes a style example,
  // weighted by engagement, so future generations lean on what worked.
  const reactions = Number(body.reactions) || 0
  const reach     = Number(body.reach) || 0
  const saves     = Number(body.saves) || 0
  const textTypes = new Set(['post', 'storytelling', 'other'])
  if (projectId && textTypes.has(contentType) && bodyText.trim().length > 80 && (reactions > 0 || reach > 0 || saves > 0)) {
    // saves signal depth of value — weigh them above likes
    const score = Math.min(100, 50 + reactions + saves * 2 + Math.floor(reach / 100))
    try {
      // de-dupe: one "winner" example per item title
      const exTitle = `Залетевший пост${title ? ` · ${String(title).slice(0, 40)}` : ''}`
      await supabase.from('style_examples')
        .delete()
        .eq('project_id', projectId)
        .eq('title', exTitle)
      await supabase.from('style_examples').insert({
        project_id:        projectId,
        content_type:      'post',
        title:             exTitle,
        body_text:         bodyText,
        warmup_phase:      warmupPhase,
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
