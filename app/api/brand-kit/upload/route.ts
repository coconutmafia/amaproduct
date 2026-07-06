import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProjectAccess } from '@/lib/projects/access'

// Uploads brand-kit assets (style samples or a logo) to the public project-brand
// bucket. Writes go through the service role after an ownership check (the bucket
// has no per-row write policy). Returns public URLs.
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const form = await request.formData()
    const projectId = String(form.get('projectId') || '')
    const rawKind = String(form.get('kind') || 'sample')
    const kind = rawKind === 'logo' ? 'logo' : rawKind === 'story' ? 'story' : rawKind === 'post' ? 'post' : rawKind === 'story-out' ? 'story-out' : 'sample'
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

    // Upload goes through the admin client (storage + brand_logo_url write) —
    // this check IS the access boundary, not a redundant one.
    const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    const files = form.getAll('files').filter((f): f is File => f instanceof File)
    if (files.length === 0) return NextResponse.json({ error: 'Нет файлов' }, { status: 400 })

    const admin = createAdminClient()
    const urls: string[] = []
    let i = 0
    for (const f of files.slice(0, 8)) {
      const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
      const folder = kind === 'story' ? 'stories' : kind === 'post' ? 'posts' : kind === 'story-out' ? 'stories-out' : 'samples'
      const path = kind === 'logo' ? `${projectId}/logo.${ext}` : `${projectId}/${folder}/${Date.now()}-${i++}.${ext}`
      const buf = Buffer.from(await f.arrayBuffer())
      const { error } = await admin.storage.from('project-brand').upload(path, buf, {
        contentType: f.type || 'image/jpeg',
        upsert: true,
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      urls.push(admin.storage.from('project-brand').getPublicUrl(path).data.publicUrl)
    }

    if (kind === 'logo' && urls[0]) {
      await admin.from('projects').update({ brand_logo_url: urls[0] }).eq('id', projectId)
    }
    return NextResponse.json({ urls })
  } catch (e) {
    console.error('[brand-kit/upload]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'upload failed' }, { status: 500 })
  }
}

// Removes one uploaded sample: deletes the storage object AND drops the URL from
// the saved sample list (brand_kit.samples / brand_kit.story.samples), so the
// photo doesn't reappear on reload.
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { projectId, url, target } = (await request.json()) as { projectId?: string; url?: string; target?: string }
    if (!projectId || !url) return NextResponse.json({ error: 'projectId и url обязательны' }, { status: 400 })

    const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    const marker = '/project-brand/'
    const i = url.indexOf(marker)
    if (i === -1) return NextResponse.json({ error: 'Не похоже на файл бренда' }, { status: 400 })
    const path = decodeURIComponent(url.slice(i + marker.length).split('?')[0])
    // Only this project's own folder — never let a URL point elsewhere
    if (!path.startsWith(`${projectId}/`)) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

    const admin = createAdminClient()
    await admin.storage.from('project-brand').remove([path]).catch(() => {})

    const { data: row } = await admin.from('projects').select('brand_kit').eq('id', projectId).single()
    const kit = (row?.brand_kit as Record<string, unknown>) || {}
    if (target === 'story') {
      const story = (kit.story as Record<string, unknown>) || {}
      const samples = (Array.isArray(story.samples) ? story.samples : []).filter((u) => u !== url)
      kit.story = { ...story, samples }
    } else {
      kit.samples = (Array.isArray(kit.samples) ? kit.samples : []).filter((u) => u !== url)
    }
    await admin.from('projects').update({ brand_kit: kit }).eq('id', projectId)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[brand-kit/upload DELETE]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'delete failed' }, { status: 500 })
  }
}
