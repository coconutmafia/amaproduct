import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// GET /api/materials/tov-status?projectId= — статус извлечения Tone of Voice
// для поллинга фоновой задачи (24.08): extract-tone-of-voice отвечает 202 и
// работает в after(), статус живёт в самом материале tone_of_voice.
// Дёшево и без rate-limit (поллинг каждые ~4с); RLS session-клиента сама
// ограничивает выборку проектами пользователя.
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const projectId = new URL(request.url).searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const { data: mat } = await supabase
    .from('project_materials')
    .select('processing_status, raw_content, created_at')
    .eq('project_id', projectId)
    .eq('material_type', 'tone_of_voice')
    .eq('title', 'Tone of Voice (извлечён из твоих текстов)')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!mat) return NextResponse.json({ exists: false })
  return NextResponse.json({
    exists:     true,
    status:     mat.processing_status,
    created_at: mat.created_at,
    error: mat.processing_status === 'error' ? String(mat.raw_content ?? '').slice(0, 500) : undefined,
  })
}
