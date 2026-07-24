import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rateLimit'
import { requirePaidAccess } from '@/lib/billing/access'
import { requireProjectAccess } from '@/lib/projects/access'
import { gateContentUnits, refundGenerations } from '@/lib/generations'
import { VIDEO_MONTAGE_UNITS } from '@/lib/generations-config'
import { isDefinitelyNotMedia, NOT_MEDIA_MESSAGE } from '@/lib/media/notMedia'
import { processMontageJob } from '@/lib/jobs/runMontageJob'

// Авто-монтаж рилса по сценарию (MVP 21 июля): клиент загрузил сырое видео в
// audio-temp (через /api/ai/transcribe/upload-url — тот же путь, что интервью),
// мы ставим фоновую задачу: паузы + субтитры + хук → готовый mp4.
// ffmpeg работает в этом же инстансе через after() — нужен запас по времени.
export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'video')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  const denied = await requirePaidAccess(user.id)
  if (denied) return denied

  let body: { projectId?: string; storagePath?: string; hookText?: string }
  try { body = await request.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const { projectId, storagePath, hookText } = body
  if (!projectId || !storagePath) return NextResponse.json({ error: 'projectId и storagePath обязательны' }, { status: 400 })
  if (!storagePath.startsWith(`${user.id}/`)) return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  if (isDefinitelyNotMedia({ ext: storagePath.split('.').pop() })) {
    return NextResponse.json({ error: NOT_MEDIA_MESSAGE }, { status: 400 })
  }

  const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  // Монтаж стоит VIDEO_MONTAGE_UNITS юнитов (решение Матвея: дороже текста,
  // т.к. Whisper + минуты CPU). Списываем ДО постановки джоба: полный провал
  // джоба возвращает всё через refundGenerations внутри раннера.
  const gate = await gateContentUnits(user.id, VIDEO_MONTAGE_UNITS)
  if (gate.blocked) {
    const code = gate.reason === 'not_entitled' ? 'payment_required' : 'limit_reached'
    return NextResponse.json({
      error: code, code,
      monthlyUsed: gate.monthlyUsed, monthlyLimit: gate.monthlyLimit,
      unitsNeeded: VIDEO_MONTAGE_UNITS,
    }, { status: 402 })
  }

  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').insert({
    user_id: user.id,
    project_id: projectId,
    type: 'montage',
    status: 'queued',
    payload: { storagePath, hookText: hookText?.slice(0, 200) ?? null, projectId },
    progress: { stage: 'queued' },
  }).select('id').single()
  if (error || !job) {
    await refundGenerations(user.id, VIDEO_MONTAGE_UNITS)
    return NextResponse.json({ error: error?.message ?? 'Не удалось создать задачу' }, { status: 500 })
  }

  after(() => processMontageJob(job.id as string))
  return NextResponse.json({ jobId: job.id, unitsCharged: VIDEO_MONTAGE_UNITS })
}
