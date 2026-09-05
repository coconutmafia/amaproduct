import { NextResponse } from 'next/server'
import { captureException } from '@/lib/sentry'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rateLimit'
import { requirePaidAccess } from '@/lib/billing/access'
import { requireProjectAccess } from '@/lib/projects/access'
import { processTranscribeJob } from '@/lib/jobs/runTranscribeJob'
import { isDefinitelyNotMedia, NOT_MEDIA_MESSAGE } from '@/lib/media/notMedia'
import { gateContentUnits, refundGenerations } from '@/lib/generations'
import { transcribeUnits } from '@/lib/generations-config'

// ffmpeg needs the Node runtime + the traced binary (see next.config).
export const runtime = 'nodejs'
export const maxDuration = 300

// Roadmap #8 — background transcription. The client uploads the audio file to
// Storage (unchanged) then calls this ONCE per file instead of looping chunk
// calls itself. Processing runs server-side via `after()`, self-continuing
// across invocations if a long interview needs more than one leg — so a
// locked/backgrounded phone no longer loses progress. The client just polls
// GET /api/jobs/[id] for status.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'transcribe')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  const denied = await requirePaidAccess(user.id)
  if (denied) return denied

  let body: { projectId?: string; storagePath?: string; ext?: string; durationSec?: number; saveTranscriptMaterial?: boolean; language?: string }
  try { body = await request.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const { projectId, storagePath, ext, durationSec, saveTranscriptMaterial } = body
  // Язык записи: ISO-639-1 от клиента (селект на странице исследования) или
  // undefined = автодетект Whisper. Иное значение молча превращаем в авто —
  // язык влияет только на качество, ломать загрузку из-за него нельзя.
  const language = typeof body.language === 'string' && /^[a-z]{2}$/.test(body.language) ? body.language : undefined
  if (!projectId || !storagePath) return NextResponse.json({ error: 'projectId и storagePath обязательны' }, { status: 400 })
  if (!storagePath.startsWith(`${user.id}/`)) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

  // Не заводим задачу на файл, из которого заведомо нечего расшифровывать
  // (17 июля так уехала в ffmpeg фотография — см. lib/media/notMedia.ts).
  // Клиент проверяет то же самое до заливки; здесь — потому что клиент можно
  // обойти, а расшифровка тратит Whisper и время воркера. Расширение берём из
  // storagePath: его формирует upload-url, тогда как ext приходит из тела.
  if (isDefinitelyNotMedia({ ext: ext ?? storagePath.split('.').pop() })) {
    return NextResponse.json({ error: NOT_MEDIA_MESSAGE }, { status: 400 })
  }

  // Whisper cost + project_materials write happen via the admin client in the
  // background job — check editor+ explicitly here.
  const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Расшифровка стоит ПО ДЛИТЕЛЬНОСТИ (1 единица за 10 минут): Whisper берёт
  // деньги за минуты, и плоская цена за файл давала −488% маржи на 8-часовых
  // записях (замер 25.08). Списанное кладём в payload — возвраты обязаны
  // вернуть РОВНО столько же, даже если прайс потом поменяется.
  // Один джоб = один файл; «Повторить» продолжает ТОТ ЖЕ джоб и повторно не
  // списывает. Возвраты: непоправимая ошибка — в раннере; брошенный на 48ч —
  // в chain-watch (маркер unitsRefunded защищает от двойного возврата).
  const units = transcribeUnits(durationSec)
  const gate = await gateContentUnits(user.id, units, 'transcribe')
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
    type: 'transcribe',
    status: 'queued',
    payload: { storagePath, ext: ext || 'mp3', durationSec: durationSec ?? null, saveTranscriptMaterial: saveTranscriptMaterial === true, unitsCharged: units, ...(language ? { language } : {}) },
    progress: { doneChunks: 0, totalChunks: durationSec ? null : null },
  }).select('id').single()
  if (error || !job) {
    await captureException(new Error(error?.message || 'job insert failed'), { where: 'transcribe POST' })
    // Юниты списаны, а джоб не создался — вернуть сразу.
    await refundGenerations(user.id, units)
    return NextResponse.json({ error: 'Не удалось создать задачу — попробуй ещё раз' }, { status: 500 })
  }

  // Kick off the first leg AFTER the response is sent — the client gets the
  // jobId immediately and starts polling; this doesn't block that response.
  after(() => processTranscribeJob(job.id as string))

  return NextResponse.json({ jobId: job.id })
}
