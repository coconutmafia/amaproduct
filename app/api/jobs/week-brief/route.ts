import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { captureException } from '@/lib/sentry'
import { rateLimit } from '@/lib/rateLimit'
import { requirePaidAccess } from '@/lib/billing/access'
import { gateContentUnits, refundGenerations } from '@/lib/generations'
import { UNIT_COSTS } from '@/lib/generations-config'
import { requireProjectAccess } from '@/lib/projects/access'
import { processWeekBriefJob } from '@/lib/jobs/runWeekBriefJob'
import type { BriefDay } from '@/lib/ai/weekBrief'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// POST /api/jobs/week-brief { projectId, days, warmupPlanId? } — фоновая
// генерация плана недели (24.08, хвост класса «долгий запрос умирает на
// мобиле»). Джоб сам сохраняет брифы в warmup_plans.plan_data — результат не
// зависит от того, доживёт ли вкладка клиента до конца генерации.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'generate-week-brief')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  const denied = await requirePaidAccess(user.id)
  if (denied) return denied

  // Недельные брифы = UNIT_COSTS.week_brief единиц (прайс-лист 25.08: замеренная
  // себестоимость $0.09-0.20). Операция входит в подписку — просто расходует
  // единицы из общего месячного лимита, как и всё остальное.
  const gate = await gateContentUnits(user.id, UNIT_COSTS.week_brief)
  if (gate.blocked) {
    const code = gate.reason === 'not_entitled' ? 'payment_required' : 'limit_reached'
    return NextResponse.json(
      { error: code, code, monthlyUsed: gate.monthlyUsed, monthlyLimit: gate.monthlyLimit },
      { status: 402 },
    )
  }

  let body: { projectId?: string; days?: BriefDay[]; warmupPlanId?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const projectId = body.projectId
  const days = Array.isArray(body.days) ? body.days.filter(d => d && Number.isFinite(Number(d.day))) : []
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  if (days.length === 0) return NextResponse.json({ error: 'Нет данных плана прогрева для этой недели' }, { status: 400 })

  const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const admin = createAdminClient()

  // warmupPlanId — цель серверного сохранения брифов. Проверяем принадлежность
  // проекту ЗДЕСЬ (доступ к проекту уже доказан выше): в джоб доезжает только
  // валидный id, чужой план через параметр не перезаписать.
  let warmupPlanId: string | null = null
  if (body.warmupPlanId && typeof body.warmupPlanId === 'string') {
    const { data: plan } = await admin
      .from('warmup_plans')
      .select('id')
      .eq('id', body.warmupPlanId)
      .eq('project_id', projectId)
      .maybeSingle()
    warmupPlanId = plan?.id ?? null
  }

  const { data: job, error } = await admin.from('jobs').insert({
    user_id:    user.id,
    project_id: projectId,
    type:       'week_brief',
    status:     'queued',
    payload:    { projectId, days, warmupPlanId },
  }).select('id').single()
  if (error || !job) {
    await captureException(new Error(error?.message || 'job insert failed'), { where: 'week-brief job POST' })
    await refundGenerations(user.id, UNIT_COSTS.week_brief)
    return NextResponse.json({ error: 'Не удалось запустить генерацию — попробуй ещё раз' }, { status: 500 })
  }

  after(() => processWeekBriefJob(job.id as string))
  return NextResponse.json({ jobId: job.id }, { status: 202 })
}
