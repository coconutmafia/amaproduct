import { NextResponse } from 'next/server'
import { captureException } from '@/lib/sentry'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProjectAccess } from '@/lib/projects/access'
import type { SupabaseClient } from '@supabase/supabase-js'

// Saved DESIGNED-STORIES sets («Мои оформленные сторис») — the gallery the
// owner asked for («я выйду, и оно всё — теперь не найду»). Frame images live
// in the public project-brand bucket (stories-out/), the set index lives in
// projects.brand_kit.story_sets (jsonb → no migration). Capped at the last
// MAX_SETS sets; trimmed/deleted sets get their storage files removed.
export const runtime = 'nodejs'

const MAX_SETS = 12

interface StoryFrameMeta { url: string; headline?: string; body?: string; cta?: string; position?: string; photo?: string; manual?: boolean; video?: boolean; source?: string; design?: unknown }
interface StorySet { id: string; created_at: string; script: string; frames: StoryFrameMeta[] }

function pathFromUrl(url: string): string | null {
  const marker = '/project-brand/'
  const i = url.indexOf(marker)
  if (i === -1) return null
  return decodeURIComponent(url.slice(i + marker.length).split('?')[0])
}

// Writes below go through the admin client (brand_kit jsonb merge + storage) —
// this check IS the access boundary, editor+ required.
async function canEditProject(supabase: SupabaseClient, projectId: string, userId: string) {
  const access = await requireProjectAccess(supabase, projectId, userId, 'editor')
  return access.ok
}

function readSets(kit: Record<string, unknown>): StorySet[] {
  return Array.isArray(kit.story_sets) ? (kit.story_sets as StorySet[]) : []
}

async function removeSetFiles(projectId: string, sets: StorySet[]) {
  const admin = createAdminClient()
  const paths = sets.flatMap((s) => s.frames.map((f) => pathFromUrl(f.url)).filter((p): p is string => !!p && p.startsWith(`${projectId}/`)))
  if (paths.length) await admin.storage.from('project-brand').remove(paths).catch(() => {})
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const projectId = new URL(request.url).searchParams.get('projectId')
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
    const { data } = await supabase.from('projects').select('brand_kit').eq('id', projectId).single()
    if (!data) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    return NextResponse.json({ sets: readSets((data.brand_kit as Record<string, unknown>) || {}) })
  } catch (e) {
    await captureException(e, { where: 'stories sets GET' })
    return NextResponse.json({ error: 'Не удалось загрузить серии — обнови страницу' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await request.json()) as { projectId?: string; setId?: string; script?: string; frames?: StoryFrameMeta[] }
    const projectId = String(body.projectId || '')
    const frames = (body.frames || []).filter((f) => f && typeof f.url === 'string' && f.url.includes('/project-brand/'))
    if (!projectId || frames.length === 0) return NextResponse.json({ error: 'projectId и frames обязательны' }, { status: 400 })
    if (!(await canEditProject(supabase, projectId, user.id))) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const admin = createAdminClient()
    const { data: row } = await admin.from('projects').select('brand_kit').eq('id', projectId).single()
    const kit = (row?.brand_kit as Record<string, unknown>) || {}
    let sets = readSets(kit)

    const setId = String(body.setId || `set-${Date.now()}`)
    const existing = sets.find((s) => s.id === setId)
    const next: StorySet = {
      id: setId,
      created_at: existing?.created_at || new Date().toISOString(),
      script: String(body.script || '').slice(0, 600),
      // 16, не 10 (Станислав, 25.08): серия из 13 кадров МОЛЧА резалась до 10
      // при сохранении — «сделал 13, в сохранённых 10». 16 = потолок серии
      // (13) с запасом; молчаливых обрезаний у сохранения быть не должно.
      frames: frames.slice(0, 16).map((f) => ({
        url: f.url,
        headline: String(f.headline || '').slice(0, 200),
        body: String(f.body || '').slice(0, 300),
        cta: String(f.cta || '').slice(0, 120),
        position: ['top', 'center', 'bottom'].includes(String(f.position)) ? String(f.position) : undefined,
        // Source photo — lets the gallery reopen the set for edits
        photo: typeof f.photo === 'string' && f.photo.includes('/project-brand/') ? f.photo : undefined,
        // Hand-designed frame — reopen reuses its stored image, never re-renders.
        manual: f.manual ? true : undefined,
        // Раскладка редактора ручного кадра (фон + блоки) — повторное
        // «Редактировать вручную» открывает реальные блоки, а не чёрный холст.
        // Компактный объект; крупные не храним, чтобы не раздувать brand_kit.
        design: (f.manual && f.design && typeof f.design === 'object' && JSON.stringify(f.design).length <= 8000) ? f.design : undefined,
        // Видео-кадр серии: url = готовый mp4; галерея показывает <video>,
        // правки/пересборка его не перерендеривают (как manual).
        video: f.video ? true : undefined,
        // Исходник видео-кадра (до текста) — для пересборки позиции текста.
        // НЕ входит в url-очистку заменённых кадров: живёт, пока жива серия.
        source: typeof f.source === 'string' && f.source.includes('/project-brand/') ? f.source : undefined,
      })),
    }

    if (existing) {
      // Replacing a set (e.g. after a chat edit) — clean files that dropped out
      const keep = new Set(next.frames.map((f) => f.url))
      await removeSetFiles(projectId, [{ ...existing, frames: existing.frames.filter((f) => !keep.has(f.url)) }])
      sets = sets.map((s) => (s.id === setId ? next : s))
    } else {
      sets = [next, ...sets]
    }

    // Cap the gallery; physically delete trimmed sets' files
    if (sets.length > MAX_SETS) {
      const trimmed = sets.slice(MAX_SETS)
      await removeSetFiles(projectId, trimmed)
      sets = sets.slice(0, MAX_SETS)
    }

    const { error } = await admin.from('projects').update({ brand_kit: { ...kit, story_sets: sets } }).eq('id', projectId)
    if (error) {
      await captureException(new Error(error.message), { where: 'stories sets DELETE' })
      return NextResponse.json({ error: 'Не удалось удалить серию — попробуй ещё раз' }, { status: 500 })
    }
    return NextResponse.json({ set: next, sets })
  } catch (e) {
    console.error('[stories/sets POST]', e instanceof Error ? e.message : e)
    await captureException(e, { where: 'stories sets POST' })
    return NextResponse.json({ error: 'Не удалось сохранить серию — попробуй ещё раз' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const url = new URL(request.url)
    const projectId = url.searchParams.get('projectId') || ''
    const setId = url.searchParams.get('setId') || ''
    if (!projectId || !setId) return NextResponse.json({ error: 'projectId и setId обязательны' }, { status: 400 })
    if (!(await canEditProject(supabase, projectId, user.id))) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const admin = createAdminClient()
    const { data: row } = await admin.from('projects').select('brand_kit').eq('id', projectId).single()
    const kit = (row?.brand_kit as Record<string, unknown>) || {}
    const sets = readSets(kit)
    const victim = sets.find((s) => s.id === setId)
    if (victim) await removeSetFiles(projectId, [victim])
    const { error } = await admin.from('projects').update({ brand_kit: { ...kit, story_sets: sets.filter((s) => s.id !== setId) } }).eq('id', projectId)
    if (error) {
      await captureException(new Error(error.message), { where: 'stories sets DELETE' })
      return NextResponse.json({ error: 'Не удалось удалить серию — попробуй ещё раз' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    await captureException(e, { where: 'stories sets DELETE' })
    return NextResponse.json({ error: 'Не удалось удалить серию — попробуй ещё раз' }, { status: 500 })
  }
}
