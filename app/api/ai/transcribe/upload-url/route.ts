import { createClient }      from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse }       from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/ai/transcribe/upload-url
 * Body: { ext: string }
 *
 * Returns a short-lived signed upload URL so the browser can PUT the audio
 * file directly into Supabase Storage without needing RLS insert policies.
 * The path is scoped to the authenticated user's folder so the transcribe
 * route can later verify ownership.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { ext?: string }
  try { body = await request.json() } catch { body = {} }

  const ext  = (body.ext ?? 'mp3').replace(/[^a-z0-9]/g, '') || 'mp3'
  const path = `${user.id}/${Date.now()}.${ext}`

  const admin = createAdminClient()
  const { data, error } = await admin.storage
    .from('audio-temp')
    .createSignedUploadUrl(path)

  if (error || !data) {
    console.error('createSignedUploadUrl error:', error)
    return NextResponse.json({ error: 'Не удалось создать ссылку для загрузки' }, { status: 500 })
  }

  return NextResponse.json({ path, signedUrl: data.signedUrl, token: data.token })
}
