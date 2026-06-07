import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

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
    const kind = rawKind === 'logo' ? 'logo' : rawKind === 'story' ? 'story' : 'sample'
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

    const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).eq('owner_id', user.id).single()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const files = form.getAll('files').filter((f): f is File => f instanceof File)
    if (files.length === 0) return NextResponse.json({ error: 'Нет файлов' }, { status: 400 })

    const admin = createAdminClient()
    const urls: string[] = []
    let i = 0
    for (const f of files.slice(0, 8)) {
      const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
      const folder = kind === 'story' ? 'stories' : 'samples'
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
