// Фоновая генерация «Плана прогрева» — хвост класса «долгий запрос умирает на
// мобиле» (мандат 24.08). Раньше план шёл SSE-стримом в открытую вкладку:
// смерть вкладки/сети на телефоне теряла 1-2 минуты генерации. Теперь клиент
// создаёт джоб и поллит /api/jobs/[id]; результат лежит в job.result.planData,
// вкладку можно закрывать. Ядро (контекст+промпт+форс-тул) — общее с SSE-роутом:
// lib/ai/warmupPlan.ts. Джоб one-shot: рестарт самолечения безопасен (результат
// пишется только целиком в конце).
import { createAdminClient } from '@/lib/supabase/admin'
import { captureException } from '@/lib/sentry'
import { generateWarmupPlan, type WarmupPlanInput } from '@/lib/ai/warmupPlan'
import { refundGenerations } from '@/lib/generations'
import { UNIT_COSTS } from '@/lib/generations-config'


// Провал = работа не состоялась → вернуть списанные на POST единицы
// (прайс-лист 25.08: операция входит в подписку, но расходует лимит).
async function refundJobUnits(job: { user_id?: string | null }) {
  if (job?.user_id) await refundGenerations(job.user_id, UNIT_COSTS.warmup_plan).catch(() => {})
}

export async function processWarmupPlanJob(jobId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').select('*').eq('id', jobId).single()
  if (error || !job) return
  if (job.status === 'done' || job.status === 'error') return // идемпотентность

  const input = job.payload as unknown as WarmupPlanInput
  if (!input?.projectId || !input?.duration) {
    await admin.from('jobs').update({ status: 'error', error: 'Данные мастера не дошли до сервера — заполни шаги и нажми «Создать план» ещё раз.' }).eq('id', jobId)
    await refundJobUnits(job)
    return
  }

  await admin.from('jobs').update({ status: 'processing' }).eq('id', jobId)

  // Heartbeat: раз в ~20с бампаем progress (триггер обновит updated_at) — джоб
  // виден как живой и самолечение в GET /api/jobs/[id] его не перезапустит.
  let chunks = 0
  let lastBeat = Date.now()
  const onProgress = () => {
    chunks++
    if (Date.now() - lastBeat > 20_000) {
      lastBeat = Date.now()
      void admin.from('jobs').update({ progress: { chunks } }).eq('id', jobId)
    }
  }

  try {
    const r = await generateWarmupPlan(admin, input, onProgress)
    if (!r.ok) {
      await admin.from('jobs').update({ status: 'error', error: r.error }).eq('id', jobId)
    await refundJobUnits(job)
      return
    }
    await admin.from('jobs').update({
      status: 'done',
      result: { planData: r.planData },
      progress: { chunks },
    }).eq('id', jobId)
  } catch (e) {
    // Ядро санитизирует свои ошибки само; сюда попадает только неожиданное.
    await captureException(e, { where: 'runWarmupPlanJob', jobId })
    await admin.from('jobs').update({
      status: 'error',
      error: 'Генерация прервалась на нашей стороне. Нажми «Создать план» ещё раз — введённые данные не потерялись.',
    }).eq('id', jobId)
      await refundJobUnits(job)
  }
}
