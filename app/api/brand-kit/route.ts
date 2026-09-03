import { NextResponse } from 'next/server'
import { captureException } from '@/lib/sentry'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProjectAccess } from '@/lib/projects/access'
import { FONT_KEYS } from '@/lib/fonts'
import { resolveContentLanguage } from '@/lib/ai/prompts/content-brain'

// Подпись-листалка на языке блога проекта (настройка «Язык блога»).
const SWIPE_LABELS: Record<string, string> = {
  ru: 'ЛИСТАЙ ДАЛЬШЕ →',
  en: 'SWIPE →',
  es: 'DESLIZA →',
  de: 'WEITER →',
  it: 'SCORRI →',
}

// Read / manually-save a project's brand kit (colours, bg style, handle, logo).
// GET ?projectId=  → brand fields (used by the brand page + slide renderer).
// POST {projectId, accentColor?, bg?, text?, bgStyle?, handle?} → save edits.

const ALLOWED_BG = ['paper', 'solid', 'gradient']

function shape(p: Record<string, unknown>) {
  const kit = (p.brand_kit as Record<string, unknown>) || {}
  return {
    accentColor: (p.brand_accent_color as string) || null,
    bg: (p.brand_bg_color as string) || null,
    text: (p.brand_text_color as string) || null,
    bgStyle: (p.brand_bg_style as string) || null,
    handle: (p.brand_handle as string) || null,
    logoUrl: (p.brand_logo_url as string) || null,
    status: (p.brand_kit_status as string) || 'none',
    // Font / accent style / free-text style notes live in the jsonb (no column
    // migration) — surface them top-level so the renderer + UI read them like
    // the other brand fields.
    font: (kit.font as string) || null,
    accentStyle: (kit.accentStyle as string) || null,
    styleNotes: (kit.styleNotes as string) || null,
    // false = убрать «ЛИСТАЙ ДАЛЬШЕ →» со слайдов (блог не на русском и т.п.)
    swipeHint: kit.swipeHint === false ? false : true,
    // Текст листалки — на языке блога (не только вкл/выкл, как раньше)
    swipeLabel: SWIPE_LABELS[resolveContentLanguage(p as { content_language?: string | null }) ?? 'ru'],
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
    // select('*'), а не список колонок: до наката миграции 038 колонки
    // content_language ещё нет — явный select с ней валил бы GET целиком.
    const { data } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId).single()
    if (!data) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    return NextResponse.json(shape(data))
  } catch (e) {
    await captureException(e, { where: 'brand-kit PUT' })
    return NextResponse.json({ error: 'Не удалось сохранить фирменный стиль — попробуй ещё раз' }, { status: 500 })
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

    // Writes below go through the admin client (brand_kit jsonb merge) — this
    // check IS the access boundary, not a redundant one.
    const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    const hex = (v: unknown) => { const s = String(v ?? '').trim(); return /^#?[0-9a-fA-F]{6}$/.test(s) ? (s.startsWith('#') ? s : '#' + s) : null }
    const update: Record<string, unknown> = {}
    if ('accentColor' in body) update.brand_accent_color = hex(body.accentColor)
    if ('bg' in body) update.brand_bg_color = hex(body.bg)
    if ('text' in body) update.brand_text_color = hex(body.text)
    if ('bgStyle' in body) update.brand_bg_style = ALLOWED_BG.includes(String(body.bgStyle)) ? String(body.bgStyle) : null
    if ('handle' in body) update.brand_handle = String(body.handle || '').trim().slice(0, 40) || null

    // Font / accent style / free-text style notes, plus the separate STORY style,
    // all live inside the brand_kit jsonb (no column migration). Build the patch,
    // then merge over the existing jsonb so unrelated keys (summary, samples)
    // survive an edit.
    const admin = createAdminClient()
    const kitPatch: Record<string, unknown> = {}
    if ('font' in body) kitPatch.font = (FONT_KEYS as string[]).includes(String(body.font)) ? String(body.font) : null
    if ('accentStyle' in body) kitPatch.accentStyle = body.accentStyle === 'flat' ? 'flat' : body.accentStyle === 'gradient' ? 'gradient' : null
    if ('styleNotes' in body) kitPatch.styleNotes = String(body.styleNotes || '').trim().slice(0, 600) || null
    if ('swipeHint' in body) kitPatch.swipeHint = body.swipeHint !== false

    let storyPatch: Record<string, unknown> | null = null
    if (body.story && typeof body.story === 'object') {
      const s = body.story as Record<string, unknown>
      const story: Record<string, unknown> = {}
      if ('accentColor' in s) story.accentColor = hex(s.accentColor)
      if ('bg' in s) story.bg = hex(s.bg)
      if ('text' in s) story.text = hex(s.text)
      if ('bgStyle' in s) story.bgStyle = ALLOWED_BG.includes(String(s.bgStyle)) ? String(s.bgStyle) : null
      if (Object.keys(story).length > 0) storyPatch = story
    }

    if (Object.keys(kitPatch).length > 0 || storyPatch) {
      const { data: row } = await admin.from('projects').select('brand_kit').eq('id', projectId).single()
      const kit = (row?.brand_kit as Record<string, unknown>) || {}
      const merged: Record<string, unknown> = { ...kit, ...kitPatch }
      if (storyPatch) merged.story = { ...((kit.story as Record<string, unknown>) || {}), ...storyPatch }
      update.brand_kit = merged
    }

    if (Object.keys(update).length === 0) return NextResponse.json({ ok: true })
    if (update.brand_accent_color || update.brand_bg_color) update.brand_kit_status = 'ready'

    const { error } = await admin.from('projects').update(update).eq('id', projectId)
    if (error) {
      await captureException(new Error(error.message), { where: 'brand-kit PUT' })
      return NextResponse.json({ error: 'Не удалось сохранить фирменный стиль — попробуй ещё раз' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    await captureException(e, { where: 'brand-kit PUT' })
    return NextResponse.json({ error: 'Не удалось сохранить фирменный стиль — попробуй ещё раз' }, { status: 500 })
  }
}
