import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { upsertProjectMaterial } from '@/lib/supabase/upsertMaterial'

// Standing per-project voice rules the blogger dictates («не пиши так», «всегда
// начинай с…»). Stored as a project material (material_type='voice_rules') so
// they show up in Материалы and reach EVERY generator through the system prompt
// (buildRAGContext → voiceRules → buildSystemPrompt, top priority).
const RULE_TITLE = 'Правила голоса (от блогера)'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { projectId, rule } = (await request.json()) as { projectId?: string; rule?: string }
    const clean = (rule || '').trim().replace(/\s+/g, ' ').slice(0, 300)
    if (!projectId || !clean) return NextResponse.json({ error: 'projectId и rule обязательны' }, { status: 400 })

    const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).single()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const { data: existing } = await supabase
      .from('project_materials')
      .select('raw_content')
      .eq('project_id', projectId)
      .eq('material_type', 'voice_rules')
      .maybeSingle()

    const prev = ((existing?.raw_content as string | null) || '').trim()
    // Dedupe identical rules; cap the list so the prompt never bloats
    if (prev.toLowerCase().includes(clean.toLowerCase())) {
      return NextResponse.json({ ok: true, rules: prev })
    }
    const lines = prev ? prev.split('\n').filter(Boolean) : []
    lines.push(`• ${clean}`)
    const next = lines.slice(-40).join('\n')

    const { error } = await upsertProjectMaterial(supabase, {
      project_id: projectId,
      title: RULE_TITLE,
      material_type: 'voice_rules',
      raw_content: next,
      processing_status: 'ready',
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, rules: next })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const projectId = new URL(request.url).searchParams.get('projectId')
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
    const { data } = await supabase
      .from('project_materials')
      .select('raw_content, project_id, projects!inner(owner_id)')
      .eq('project_id', projectId)
      .eq('material_type', 'voice_rules')
      .maybeSingle()
    return NextResponse.json({ rules: (data?.raw_content as string | null) || '' })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}
