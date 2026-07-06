import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { WarmupPhase } from '@/types'

// Save a content unit straight into the content plan (no AI) — used when the
// user generates in the assistant chat and taps «Сохранить в план».
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { projectId, contentType, dayNumber, phase, bodyText, title } = await request.json() as {
      projectId?: string; contentType?: string; dayNumber?: number; phase?: string; bodyText?: string; title?: string
    }
    if (!projectId || !contentType || !bodyText?.trim()) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // RLS (content_items_write, migration 025) is the access boundary — the
    // session client enforces editor+ directly on the insert below.
    const { data: project } = await supabase
      .from('projects').select('id').eq('id', projectId).single()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    // Map any phase name → a value allowed by the content_items CHECK constraint.
    const VALID = new Set(['awareness', 'trust', 'desire', 'close', 'activation'])
    const MAP: Record<string, string> = {
      niche: 'awareness', expert: 'trust', product: 'desire', objections: 'close',
      phase_1: 'awareness', phase_2: 'trust', phase_3: 'desire', phase_4: 'close',
    }
    const dbPhase = (MAP[phase ?? ''] ?? (VALID.has(phase ?? '') ? phase : 'awareness')) as WarmupPhase

    const clean = bodyText.replace(/#[\wА-Яа-яЁё]+/g, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

    const { count } = await supabase
      .from('content_items')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId).eq('content_type', contentType).eq('day_number', dayNumber ?? 0)

    const { data: item, error } = await supabase
      .from('content_items')
      .insert({
        project_id: projectId,
        content_type: contentType,
        title: (title || clean.split('\n').find(l => l.trim()) || `${contentType}`).slice(0, 80),
        day_number: dayNumber ?? null,
        warmup_phase: dbPhase,
        body_text: clean,
        structured_data: null,
        hashtags: null,
        version_number: (count || 0) + 1,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ item })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
