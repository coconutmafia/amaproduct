// Фоновый «Анализ конкурентов» — хвост класса «долгий запрос умирает на
// мобиле» (мандат 24.08). Форс-тул с ретраями на пустой список занимает до
// 1-2 минут — раньше это был sync-запрос из открытой вкладки. Теперь: джоб +
// поллинг; jobId в localStorage — вкладку можно закрывать, таблица откроется
// по возвращении. Ядро — lib/ai/competitorTable.ts.
import { createAdminClient } from '@/lib/supabase/admin'
import { captureException } from '@/lib/sentry'
import { analyzeCompetitors } from '@/lib/ai/competitorTable'

export async function processCompetitorAnalysisJob(jobId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').select('*').eq('id', jobId).single()
  if (error || !job) return
  if (job.status === 'done' || job.status === 'error') return // идемпотентность

  const projectId = (job.payload as { projectId?: string })?.projectId || job.project_id
  if (!projectId) {
    await admin.from('jobs').update({ status: 'error', error: 'Проект не найден — обнови страницу и попробуй ещё раз.' }).eq('id', jobId)
    return
  }

  await admin.from('jobs').update({ status: 'processing' }).eq('id', jobId)

  try {
    const r = await analyzeCompetitors(admin, projectId)
    if (!r.ok) {
      await admin.from('jobs').update({ status: 'error', error: r.error }).eq('id', jobId)
      return
    }
    await admin.from('jobs').update({
      status: 'done',
      result: { competitors: r.rows },
    }).eq('id', jobId)
  } catch (e) {
    await captureException(e, { where: 'runCompetitorAnalysisJob', jobId, projectId })
    await admin.from('jobs').update({
      status: 'error',
      error: 'Анализ прервался на нашей стороне. Запусти «Анализ конкурентов» ещё раз.',
    }).eq('id', jobId)
  }
}
