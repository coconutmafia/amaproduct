import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { captureException } from '@/lib/sentry'
import { rateLimit } from '@/lib/rateLimit'
import { requirePaidAccess } from '@/lib/billing/access'
import { gateContentUnits, refundGenerations } from '@/lib/generations'
import { UNIT_COSTS } from '@/lib/generations-config'
import { requireProjectAccess } from '@/lib/projects/access'
import { processWarmupPlanJob } from '@/lib/jobs/runWarmupPlanJob'
import type { WarmupPlanInput } from '@/lib/ai/warmupPlan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// POST /api/jobs/warmup-plan {…поля мастера…} — фоновая генерация плана
// прогрева (24.08, хвост класса «долгий запрос умирает на мобиле»). Клиент
// кладёт jobId в черновик мастера СРАЗУ и поллит GET /api/jobs/[id] —
// смерть вкладки/сети больше не теряет 1-2 минуты генерации.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'warmup-plan')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  const denied = await requirePaidAccess(user.id)
  if (denied) return denied

  // План прогрева = UNIT_COSTS.warmup_plan единиц (прайс-лист 25.08: замеренная
  // себестоимость $0.10-0.20). Операция входит в подписку — просто расходует
  // единицы из общего месячного лимита, как и всё остальное.
  const gate = await gateContentUnits(user.id, UNIT_COSTS.warmup_plan, 'warmup_plan')
  if (gate.blocked) {
    const code = gate.reason === 'not_entitled' ? 'payment_required' : 'limit_reached'
    return NextResponse.json(
      { error: code, code, monthlyUsed: gate.monthlyUsed, monthlyLimit: gate.monthlyLimit },
      { status: 402 },
    )
  }

  let body: WarmupPlanInput
  try { body = await request.json() as WarmupPlanInput } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (!body?.projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  if (!Number.isFinite(Number(body.duration)) || Number(body.duration) < 1) {
    return NextResponse.json({ error: 'Не указана длительность прогрева — проверь даты на шаге 2.' }, { status: 400 })
  }

  // Дорогая генерация на деньги владельца — editor+, как в SSE-роуте.
  const access = await requireProjectAccess(supabase, body.projectId, user.id, 'editor')
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').insert({
    user_id:    user.id,
    project_id: body.projectId,
    type:       'warmup_plan',
    status:     'queued',
    payload:    body as unknown as Record<string, unknown>,
  }).select('id').single()
  if (error || !job) {
    await captureException(new Error(error?.message || 'job insert failed'), { where: 'warmup-plan job POST' })
    await refundGenerations(user.id, UNIT_COSTS.warmup_plan)
    return NextResponse.json({ error: 'Не удалось запустить генерацию — попробуй ещё раз' }, { status: 500 })
  }

  after(() => processWarmupPlanJob(job.id as string))
  return NextResponse.json({ jobId: job.id }, { status: 202 })
}
