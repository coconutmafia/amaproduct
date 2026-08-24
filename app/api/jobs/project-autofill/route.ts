import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { captureException } from '@/lib/sentry'
import { rateLimit } from '@/lib/rateLimit'
import { requirePaidAccess } from '@/lib/billing/access'
import { processAutofillJob } from '@/lib/jobs/runAutofillJob'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// POST /api/jobs/project-autofill { instagramUrl?, telegramUrl? } — фоновое
// автозаполнение мастера проектов (24.08, хвост класса «долгий запрос умирает
// на мобиле»). Проекта ещё НЕТ (это онбординг) — джоб без project_id, привязан
// к пользователю. Клиент кладёт jobId в localStorage СРАЗУ и поллит.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'autofill')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  const denied = await requirePaidAccess(user.id)
  if (denied) return denied

  const body = await request.json().catch(() => ({})) as { url?: string; instagramUrl?: string; telegramUrl?: string }
  const instagramRaw = (body.instagramUrl || (body.url && body.url.includes('instagram') ? body.url : '') || '').trim()
  const telegramRaw  = (body.telegramUrl  || (body.url && (body.url.includes('t.me') || body.url.includes('telegram')) ? body.url : '') || '').trim()

  if (!instagramRaw && !telegramRaw) {
    return NextResponse.json({ error: 'Укажи ссылку на Instagram или Telegram' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').insert({
    user_id: user.id,
    type:    'project_autofill',
    status:  'queued',
    payload: { instagramRaw: instagramRaw.slice(0, 300), telegramRaw: telegramRaw.slice(0, 300) },
  }).select('id').single()
  if (error || !job) {
    await captureException(new Error(error?.message || 'job insert failed'), { where: 'project-autofill job POST' })
    return NextResponse.json({ error: 'Не удалось запустить анализ — попробуй ещё раз' }, { status: 500 })
  }

  after(() => processAutofillJob(job.id as string))
  return NextResponse.json({ jobId: job.id }, { status: 202 })
}
