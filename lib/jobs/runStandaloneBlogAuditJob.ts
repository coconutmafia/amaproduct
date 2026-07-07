import { createAdminClient } from '@/lib/supabase/admin'
import { captureException } from '@/lib/sentry'
import { scrapeInstagram, buildAccountText, extractImageUrls, IMAGE_URLS_HEADER } from '@/lib/instagram/scrapeAccount'
import { runBlogAudit } from '@/lib/blogAudit/runBlogAudit'

interface JobRow {
  id: string
  status: string
  payload: { username: string }
}

// Автономная диагностика блога по введённому @хендлу — БЕЗ проекта (вход с
// главной, для тех, у кого ещё нет проектов). В отличие от проектного аудита
// (который берёт текст из сохранённого материала), здесь скрейпим профиль на
// лету через Apify, собираем текст + картинки и прогоняем аудит. jobs+after()
// как у остального: одна итерация (скрейп ~30-60с + Claude ~20-40с) укладывается
// в maxDuration=300; клиент поллит статус.
export async function processStandaloneBlogAuditJob(jobId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').select('*').eq('id', jobId).single()
  if (error || !job) return
  const row = job as unknown as JobRow
  if (row.status === 'done' || row.status === 'error') return

  const apifyToken = process.env.APIFY_TOKEN
  if (!apifyToken) {
    await admin.from('jobs').update({ status: 'error', error: 'APIFY_TOKEN не настроен в окружении' }).eq('id', jobId)
    return
  }

  await admin.from('jobs').update({ status: 'processing' }).eq('id', jobId)
  const { username } = row.payload

  try {
    const profile = await scrapeInstagram(username, apifyToken)
    const hasBio = !!(profile.biography || profile.bio)
    const postsArr = (profile.latestPosts || profile.posts) as unknown[] | undefined
    if (!hasBio && (!Array.isArray(postsArr) || postsArr.length === 0)) {
      throw new Error('Instagram не вернул ни описания, ни постов — возможно, профиль приватный или такого аккаунта нет. Проверь @имя и попробуй снова.')
    }

    const accountText = buildAccountText(profile)
    const imageUrls   = extractImageUrls(profile)
    const profileText = imageUrls.length
      ? `${accountText}\n\n${IMAGE_URLS_HEADER}\n${imageUrls.join('\n')}`
      : accountText

    const result = await runBlogAudit(username, profileText)
    await admin.from('jobs').update({ status: 'done', result: result as unknown as Record<string, unknown> }).eq('id', jobId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка диагностики'
    console.error('[runStandaloneBlogAuditJob] error:', msg)
    await admin.from('jobs').update({ status: 'error', error: msg }).eq('id', jobId)
    await captureException(err, { where: 'runStandaloneBlogAuditJob', jobId, username })
  }
}
