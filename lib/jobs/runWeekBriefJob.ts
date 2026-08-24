// Фоновая генерация «Плана недели» (брифы контент-плана) — хвост класса
// «долгий запрос умирает на мобиле» (мандат 24.08). Раньше 20-60с sync-запрос
// жил в открытой вкладке; смерть вкладки теряла результат И деньги вызова.
// Теперь: джоб + поллинг, а главное — брифы сохраняются в
// warmup_plans.plan_data ПРЯМО ИЗ ДЖОБА: даже если клиент не вернётся вовсе,
// план недели будет ждать его в контент-плане. Ядро — lib/ai/weekBrief.ts.
import { createAdminClient } from '@/lib/supabase/admin'
import { captureException } from '@/lib/sentry'
import { generateWeekBrief, weekBriefDayFormats, type BriefDay, type WeekBriefDayResult } from '@/lib/ai/weekBrief'

interface WeekBriefPayload {
  projectId?: string
  days?: BriefDay[]
  // Проверен на принадлежность проекту при создании джоба (роут) — сюда
  // доезжает только валидный id или null.
  warmupPlanId?: string | null
}

// Слить сгенерированные брифы в plan_data — то же, что делает клиентский
// persistPlan: трогаем ТОЛЬКО дни из запроса, форматы = выбор пользователя на
// момент запуска, брифы фильтруем по этим форматам (правило клиента).
export function mergeBriefsIntoPlanData(
  planData: Record<string, unknown>,
  requestDays: BriefDay[],
  generated: WeekBriefDayResult[],
): Record<string, unknown> {
  const byDay = new Map(generated.map(d => [d.day, d.brief]))
  const reqByDay = new Map(requestDays.map(d => [d.day, d]))
  const next = JSON.parse(JSON.stringify(planData)) as { warmup_plan?: { phases?: Array<{ daily_plan?: Array<Record<string, unknown>> }> } }
  for (const phase of next.warmup_plan?.phases ?? []) {
    for (const dp of phase.daily_plan ?? []) {
      const dayNum = dp.day as number
      const brief = byDay.get(dayNum)
      const req = reqByDay.get(dayNum)
      if (!brief || !req) continue
      const chosen = weekBriefDayFormats(req)
      const filtered: Record<string, string> = {}
      for (const f of chosen) if (brief[f]) filtered[f] = brief[f]
      dp.formats = chosen
      if (Object.keys(filtered).length > 0) dp.briefs = filtered
    }
  }
  return next as Record<string, unknown>
}

export async function processWeekBriefJob(jobId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').select('*').eq('id', jobId).single()
  if (error || !job) return
  if (job.status === 'done' || job.status === 'error') return // идемпотентность

  const payload = job.payload as WeekBriefPayload
  const projectId = payload?.projectId
  const days = Array.isArray(payload?.days) ? payload.days : []
  if (!projectId || days.length === 0) {
    await admin.from('jobs').update({ status: 'error', error: 'Нет данных плана прогрева для этой недели.' }).eq('id', jobId)
    return
  }

  await admin.from('jobs').update({ status: 'processing' }).eq('id', jobId)

  try {
    const r = await generateWeekBrief(admin, projectId, days)
    if (!r.ok) {
      await admin.from('jobs').update({ status: 'error', error: r.error }).eq('id', jobId)
      return
    }

    // Серверное сохранение: клиент может уже никогда не вернуться — брифы
    // обязаны лежать в плане. Живой клиент после done перезапишет plan_data
    // своим (более свежим) состоянием — сходится к его виду.
    if (payload.warmupPlanId) {
      try {
        const { data: plan } = await admin
          .from('warmup_plans')
          .select('id, plan_data')
          .eq('id', payload.warmupPlanId)
          .eq('project_id', projectId)
          .maybeSingle()
        if (plan?.plan_data) {
          const next = mergeBriefsIntoPlanData(plan.plan_data as Record<string, unknown>, days, r.days)
          await admin.from('warmup_plans').update({ plan_data: next }).eq('id', plan.id)
        }
      } catch (e) {
        // Персист — страховка, не условие успеха: брифы есть в job.result.
        await captureException(e, { where: 'runWeekBriefJob persist', jobId, projectId })
      }
    }

    await admin.from('jobs').update({
      status: 'done',
      result: { days: r.days },
    }).eq('id', jobId)
  } catch (e) {
    await captureException(e, { where: 'runWeekBriefJob', jobId, projectId })
    await admin.from('jobs').update({
      status: 'error',
      error: 'Генерация прервалась на нашей стороне. Нажми «План недели» ещё раз.',
    }).eq('id', jobId)
  }
}
