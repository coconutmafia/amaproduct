import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/materials/[id]/file — short-lived signed URL to download the
// original uploaded file. 'materials' is a PRIVATE bucket (may hold sensitive
// business/client data — audience research, interview transcripts): a public
// bucket would let anyone with a leaked/guessed link open the file forever.
// This route checks project ownership under the user's session, then mints a
// signed URL (5 min) via the service-role client — same pattern as
// video/overlay's use of createSignedUrl on project-brand.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data: material } = await supabase
    .from('project_materials')
    .select('id, file_url, project_id')
    .eq('id', id)
    .single()
  if (!material?.file_url) return NextResponse.json({ error: 'У этого материала нет файла' }, { status: 404 })

  const { data: project } = await supabase
    .from('projects').select('id').eq('id', material.project_id).eq('owner_id', user.id).single()
  if (!project) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: signed, error } = await admin.storage
    .from('materials')
    .createSignedUrl(material.file_url as string, 300)
  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: 'Файл не найден в хранилище' }, { status: 404 })
  }

  return NextResponse.json({ url: signed.signedUrl })
}
