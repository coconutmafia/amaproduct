import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rateLimit'
import { requirePaidAccess } from '@/lib/billing/access'
import { processTranscribeJob } from '@/lib/jobs/runTranscribeJob'

export const runtime = 'nodejs'
export const maxDuration = 300

// POST /api/jobs/transcribe/retry { jobId } — продолжить УПАВШУЮ расшифровку
// с места обрыва. Работает потому, что джоб и так умеет резюмиться: прогресс
// (doneChunks) и накопленный текст лежат в jobs, а файл при временной ошибке
// (кредиты/перегруз/сеть) больше не удаляется из audio-temp (см.
// runTranscribeJob). Повтор = вернуть статус queued и снова запустить раннер —
// уже оплаченные части Whisper не переплачиваются.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'transcribe')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  const denied = await requirePaidAccess(user.id)
  if (denied) return denied

  let body: { jobId?: string }
  try { body = await request.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  if (!body.jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })

  // Владение проверяет RLS (jobs_owner_select): чужой джоб просто не найдётся.
  const { data: job } = await supabase
    .from('jobs')
    .select('id, type, status, payload')
    .eq('id', body.jobId)
    .single()
  if (!job) return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 })
  if (job.type !== 'transcribe') return NextResponse.json({ error: 'Повтор доступен только для расшифровки' }, { status: 400 })
  if (job.status !== 'error') {
    // Джоб жив или уже готов — клиенту достаточно продолжить поллинг.
    return NextResponse.json({ ok: true, status: job.status })
  }

  const storagePath = (job.payload as { storagePath?: string } | null)?.storagePath
  if (!storagePath) return NextResponse.json({ error: 'Файл не найден — загрузи его заново' }, { status: 410 })

  // Файл ещё в хранилище? (при постоянных ошибках и чисткой 48ч он удаляется)
  const admin = createAdminClient()
  const { error: signErr } = await admin.storage.from('audio-temp').createSignedUrl(storagePath, 60)
  if (signErr) {
    return NextResponse.json({
      error: 'Файл уже удалён из временного хранилища — загрузи его ещё раз, расшифровка начнётся заново.',
    }, { status: 410 })
  }

  // Условный апдейт: только из состояния error (двойной клик не породит гонку —
  // второй запрос увидит 0 обновлённых строк и просто продолжит поллинг).
  const { data: updated } = await admin
    .from('jobs')
    .update({ status: 'queued', error: null })
    .eq('id', job.id)
    .eq('status', 'error')
    .select('id')
  if (updated && updated.length > 0) {
    after(() => processTranscribeJob(job.id as string))
  }

  return NextResponse.json({ ok: true, status: 'queued' })
}
