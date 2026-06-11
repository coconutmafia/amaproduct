import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Read / manually-save a project's brand kit (colours, bg style, handle, logo).
// GET ?projectId=  → brand fields (used by the brand page + slide renderer).
// POST {projectId, accentColor?, bg?, text?, bgStyle?, handle?} → save edits.

const ALLOWED_BG = ['paper', 'solid', 'gradient']

function shape(p: Record<string, unknown>) {
  return {
    accentColor: (p.brand_accent_color as string) || null,
    bg: (p.brand_bg_color as string) || null,
    text: (p.brand_text_color as string) || null,
    bgStyle: (p.brand_bg_style as string) || null,
    handle: (p.brand_handle as string) || null,
    logoUrl: (p.brand_logo_url as string) || null,
    status: (p.brand_kit_status as string) || 'none',
    kit: (p.brand_kit as Record<string, unknown>) || null,
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
      .from('projects')
      .select('brand_accent_color, brand_bg_color, brand_text_color, brand_bg_style, brand_handle, brand_logo_url, brand_kit_status, brand_kit')
      .eq('id', projectId).eq('owner_id', user.id).single()
    if (!data) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    return NextResponse.json(shape(data))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = (await request.json()) as Record<string, unknown>
    const projectId = String(body.projectId || '')
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

    const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).eq('owner_id', user.id).single()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const hex = (v: unknown) => { const s = String(v ?? '').trim(); return /^#?[0-9a-fA-F]{6}$/.test(s) ? (s.startsWith('#') ? s : '#' + s) : null }
    const update: Record<string, unknown> = {}
    if ('accentColor' in body) update.brand_accent_color = hex(body.accentColor)
    if ('bg' in body) update.brand_bg_color = hex(body.bg)
    if ('text' in body) update.brand_text_color = hex(body.text)
    if ('bgStyle' in body) update.brand_bg_style = ALLOWED_BG.includes(String(body.bgStyle)) ? String(body.bgStyle) : null
    if ('handle' in body) update.brand_handle = String(body.handle || '').trim().slice(0, 40) || null

    // Separate STORY style — lives inside the brand_kit jsonb (no migration
    // needed): merged over the main brand when rendering story frames.
    const admin = createAdminClient()
    if (body.story && typeof body.story === 'object') {
      const s = body.story as Record<string, unknown>
      const story: Record<string, unknown> = {}
      if ('accentColor' in s) story.accentColor = hex(s.accentColor)
      if ('bg' in s) story.bg = hex(s.bg)
      if ('text' in s) story.text = hex(s.text)
      if ('bgStyle' in s) story.bgStyle = ALLOWED_BG.includes(String(s.bgStyle)) ? String(s.bgStyle) : null
      if (Object.keys(story).length > 0) {
        const { data: row } = await admin.from('projects').select('brand_kit').eq('id', projectId).single()
        const kit = (row?.brand_kit as Record<string, unknown>) || {}
        const prevStory = (kit.story as Record<string, unknown>) || {}
        update.brand_kit = { ...kit, story: { ...prevStory, ...story } }
      }
    }

    if (Object.keys(update).length === 0) return NextResponse.json({ ok: true })
    if (update.brand_accent_color || update.brand_bg_color) update.brand_kit_status = 'ready'

    const { error } = await admin.from('projects').update(update).eq('id', projectId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}
