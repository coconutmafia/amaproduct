import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rateLimit'
import { requireProjectAccess } from '@/lib/projects/access'
import { gateContentUnit, refundGeneration } from '@/lib/generations'
import { processVideoOverlayJob } from '@/lib/jobs/runVideoOverlayJob'

export const runtime = 'nodejs'
export const maxDuration = 300

// POST /api/jobs/video-overlay — наложение текста на видео как фоновый джоб
// (замена синхронного /api/video/overlay для клиентов: 1-3-минутный fetch не
// переживал сворачивание вкладки телефоном; джоб — переживает, клиент поллит
// GET /api/jobs/[id]). Юнит списывается здесь, провал джоба его возвращает.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'video')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  let body: { projectId?: string; videoPath?: string; text?: string; position?: string; plate?: boolean; keepSource?: boolean }
  try { body = await request.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const { projectId, videoPath, text, position, plate, keepSource } = body
  if (!projectId || !videoPath || !text?.trim()) {
    return NextResponse.json({ error: 'projectId, videoPath и text обязательны' }, { status: 400 })
  }
  if (!videoPath.startsWith(`${projectId}/videos/`)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Жжём юнит ДО постановки (как монтаж); любой провал джоба вернёт его.
  const gate = await gateContentUnit(user.id)
  if (gate.blocked) {
    const code = gate.reason === 'not_entitled' ? 'payment_required' : 'limit_reached'
    return NextResponse.json(
      { error: code, code, monthlyUsed: gate.monthlyUsed, monthlyLimit: gate.monthlyLimit },
      { status: 402 },
    )
  }

  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').insert({
    user_id: user.id,
    project_id: projectId,
    type: 'video_overlay',
    status: 'queued',
    payload: {
      projectId,
      videoPath,
      text: text.trim().slice(0, 400),
      position: position || 'bottom',
      plate: plate !== false,
      keepSource: keepSource === true,
    },
  }).select('id').single()
  if (error || !job) {
    await refundGeneration(user.id).catch(() => {})
    return NextResponse.json({ error: 'Не удалось поставить обработку видео — попробуй ещё раз' }, { status: 500 })
  }

  after(() => processVideoOverlayJob(job.id as string))

  return NextResponse.json({ jobId: job.id })
}
