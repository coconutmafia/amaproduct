import { createAdminClient } from '@/lib/supabase/admin'
import { anthropic, MODEL } from '@/lib/ai/client'
import { captureException } from '@/lib/sentry'
import { scrapeInstagram, buildAccountText, extractImageUrls, IMAGE_URLS_HEADER, ANALYSIS_SYSTEM, buildAnalysisPrompt } from '@/lib/instagram/scrapeAccount'

interface JobRow {
  id: string
  status: string
  payload: { projectId: string; username: string; accountType: 'my_instagram' | 'competitors' }
}

// Runs an Instagram-scrape job to completion in a single leg — unlike
// transcription, a profile+25-posts scrape and one Claude analysis call
// comfortably fit inside maxDuration=300s, so there's no self-continuation
// here. The point of the jobs pattern for this route isn't chunking, it's the
// same reliability win as roadmap #8: the client no longer holds a live SSE
// connection open for ~30-60s — a locked/backgrounded phone doesn't kill the
// analysis mid-flight, it just resumes polling once the tab wakes.
export async function processInstagramScrapeJob(jobId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').select('*').eq('id', jobId).single()
  if (error || !job) return
  const row = job as unknown as JobRow
  if (row.status === 'done' || row.status === 'error') return // already finished

  const apifyToken = process.env.APIFY_TOKEN
  if (!apifyToken) {
    await admin.from('jobs').update({ status: 'error', error: 'APIFY_TOKEN не настроен в окружении' }).eq('id', jobId)
    return
  }

  await admin.from('jobs').update({ status: 'processing' }).eq('id', jobId)

  const { projectId, username, accountType } = row.payload

  try {
    const profile = await scrapeInstagram(username, apifyToken)

    // Chain-integrity guard: if the actor returns neither bio nor posts
    // (private profile OR the actor changed its field names), DON'T save a
    // near-empty my_instagram/competitors material — surface the failure so
    // the link doesn't silently degrade. Log the keys to catch schema drift.
    const hasBio = !!(profile.biography || profile.bio)
    const postsArr = (profile.latestPosts || profile.posts) as unknown[] | undefined
    if (!hasBio && (!Array.isArray(postsArr) || postsArr.length === 0)) {
      console.warn('[runInstagramScrapeJob] empty profile — keys:', Object.keys(profile).join(','))
      throw new Error('Instagram не вернул ни описания, ни постов (приватный профиль или изменился формат данных). Материал не сохранён — попробуй ещё раз или добавь тексты вручную.')
    }
    const accountText = buildAccountText(profile)

    // AI analysis (small, fast — ~30s). Don't fail the whole job if this
    // errors — keep the raw scraped data so the link isn't lost.
    let analysis = ''
    try {
      const resp = await anthropic.messages.create({
        model:      MODEL,
        max_tokens: 3000,
        system:     ANALYSIS_SYSTEM,
        messages:   [{ role: 'user', content: buildAnalysisPrompt(accountText, accountType === 'my_instagram') }],
      })
      analysis = resp.content.map(b => (b.type === 'text' ? b.text : '')).join('\n').trim()
    } catch (err) {
      console.error('[runInstagramScrapeJob] analysis failed:', err)
    }

    // Image URLs (avatar + post covers) — appended for the blog-audit visual
    // check; only for the OWN account (competitors don't get a visual audit).
    const imageUrls = accountType === 'my_instagram' ? extractImageUrls(profile) : []
    const imagesBlock = imageUrls.length ? `\n\n${IMAGE_URLS_HEADER}\n${imageUrls.join('\n')}` : ''

    const fullText = (analysis
      ? `${analysis}\n\n──────────\nСЫРЫЕ ДАННЫЕ (${new Date().toLocaleString('ru-RU')})\n\n${accountText}`
      : `${accountText}\n\n(AI-анализ не удалось сгенерировать — попробуй позже на этом материале вручную)`) + imagesBlock

    const { error: insertErr } = await admin.from('project_materials').insert({
      project_id:        projectId,
      title:             `@${username}`,
      material_type:     accountType,
      raw_content:       fullText,
      processing_status: 'ready',
    })
    if (insertErr) throw new Error(`Не удалось сохранить: ${insertErr.message}`)

    await admin.from('jobs').update({ status: 'done', result: { username } }).eq('id', jobId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка скрейпинга'
    console.error('[runInstagramScrapeJob] error:', msg)
    await admin.from('jobs').update({ status: 'error', error: msg }).eq('id', jobId)
    await captureException(err, { where: 'runInstagramScrapeJob', jobId, username })
  }
}
