// «Раннер» почтового ящика genFormat-чата (chat_gen) для самолечения.
// Ящик — не настоящий джоб: генерация живёт в стриме /api/ai/chat, и если
// инвокация умерла на середине (деплой/убитый воркер), продолжить диалоговый
// стрим нечем — честно закрываем с ВОЗВРАТОМ юнита (он был списан до стрима).
// Вызывается самолечением GET /api/jobs/[id], когда строка застряла в
// processing (10+ минут — нормальный ответ укладывается в минуты).
import { createAdminClient } from '@/lib/supabase/admin'
import { refundGeneration } from '@/lib/generations'
import { captureException } from '@/lib/sentry'

export async function processChatGenJob(jobId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: job } = await admin.from('jobs').select('id, user_id, status').eq('id', jobId).single()
  if (!job) return
  if (job.status === 'done' || job.status === 'error') return // идемпотентность

  const { data: marked } = await admin
    .from('jobs')
    .update({ status: 'error', error: 'Ответ прервался на сервере — отправь сообщение ещё раз. Единица контента возвращена.' })
    .eq('id', jobId)
    .in('status', ['queued', 'processing']) // только один из параллельных поллеров
    .select('id')
  if (marked && marked.length > 0 && job.user_id) {
    await refundGeneration(job.user_id as string).catch(async (e) => {
      await captureException(e, { where: 'processChatGenJob refund', jobId })
    })
  }
}
