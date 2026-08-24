// Фоновое «Автозаполнение мастера проектов» — хвост класса «долгий запрос
// умирает на мобиле» (мандат 24.08). Скрейп Telegram/Instagram + разбор Claude
// занимает 20-90с (холодный Apify) — раньше это был sync-запрос из открытой
// вкладки, и мобильная сеть его рвала на самом первом шаге онбординга.
// Теперь: джоб + поллинг; jobId в localStorage мастера — вкладку можно
// закрывать, поля дозаполнятся по возвращении. Ядро — lib/projects/autofill.ts.
import { createAdminClient } from '@/lib/supabase/admin'
import { captureException } from '@/lib/sentry'
import { runAutofill, type AutofillInput } from '@/lib/projects/autofill'

export async function processAutofillJob(jobId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').select('*').eq('id', jobId).single()
  if (error || !job) return
  if (job.status === 'done' || job.status === 'error') return // идемпотентность

  const payload = job.payload as unknown as AutofillInput
  const instagramRaw = String(payload?.instagramRaw ?? '')
  const telegramRaw = String(payload?.telegramRaw ?? '')
  if (!instagramRaw && !telegramRaw) {
    await admin.from('jobs').update({ status: 'error', error: 'Укажи ссылку на Instagram или Telegram' }).eq('id', jobId)
    return
  }

  await admin.from('jobs').update({ status: 'processing' }).eq('id', jobId)

  try {
    const r = await runAutofill({ instagramRaw, telegramRaw })
    if (!r.ok) {
      // Тексты ядра готовы для клиента (граница доверия соблюдена в ядре).
      await admin.from('jobs').update({ status: 'error', error: r.error }).eq('id', jobId)
      return
    }
    await admin.from('jobs').update({
      status: 'done',
      result: {
        platform: r.platform,
        niche: r.niche,
        description: r.description,
        target_audience: r.target_audience,
        content_goals: r.content_goals,
      },
    }).eq('id', jobId)
  } catch (e) {
    await captureException(e, { where: 'runAutofillJob', jobId })
    await admin.from('jobs').update({
      status: 'error',
      error: 'Не удалось проанализировать профиль — попробуй ещё раз через минуту. Поля можно заполнить и вручную ниже.',
    }).eq('id', jobId)
  }
}
