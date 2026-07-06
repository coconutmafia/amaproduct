import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProjectAccess } from '@/lib/projects/access'

// Signed upload URL for a source VIDEO (text-overlay feature). Videos are way
// over Vercel's ~4.5MB body cap, so the browser PUTs straight into Storage —
// same pattern as interview audio.
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { projectId, ext: rawExt } = (await request.json()) as { projectId?: string; ext?: string }
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
    // Upload target goes through the admin/service-role client — this check IS
    // the access boundary, not a redundant one.
    const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    const ext = (rawExt || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4'
    const path = `${projectId}/videos/${Date.now()}.${ext}`
    const admin = createAdminClient()
    const { data, error } = await admin.storage.from('project-brand').createSignedUploadUrl(path)
    if (error || !data) return NextResponse.json({ error: 'Не удалось создать ссылку для загрузки' }, { status: 500 })
    return NextResponse.json({ path, token: data.token })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}
