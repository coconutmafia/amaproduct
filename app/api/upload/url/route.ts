import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProjectAccess } from '@/lib/projects/access'
import { MAX_UPLOAD_BYTES, isMediaFile, MEDIA_NOT_HERE, tooLargeMessage, storageObjectName } from '@/lib/materials/uploadRules'

export const dynamic = 'force-dynamic'

// POST /api/upload/url — подписанная ссылка для ПРЯМОЙ загрузки материала в
// бакет materials (обход потолка Vercel 4,5 МБ на тело запроса, см.
// lib/materials/uploadRules.ts). Путь — projects/<id>/…, доступ к проекту
// проверяем здесь; /api/upload потом принимает только этот путь.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { projectId?: string; fileName?: string; size?: number; mimeType?: string }
  try { body = await request.json() } catch { body = {} }
  const projectId = String(body.projectId || '')
  const fileName = String(body.fileName || '').slice(0, 200)
  const size = Number(body.size || 0)
  if (!projectId || !fileName) return NextResponse.json({ error: 'Нет проекта или имени файла' }, { status: 400 })
  if (isMediaFile(fileName, body.mimeType)) return NextResponse.json({ error: MEDIA_NOT_HERE, code: 'media_not_here' }, { status: 400 })
  if (size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: tooLargeMessage(size), code: 'too_large' }, { status: 400 })

  const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const path = `projects/${projectId}/${storageObjectName(fileName)}`
  const { data, error } = await createAdminClient().storage.from('materials').createSignedUploadUrl(path)
  if (error || !data) {
    console.error('[upload/url] createSignedUploadUrl:', error)
    return NextResponse.json({ error: 'Не удалось создать ссылку для загрузки' }, { status: 500 })
  }
  return NextResponse.json({ path, token: data.token })
}
