import { createAdminClient } from '@/lib/supabase/admin'
import { anthropic, MODEL } from '@/lib/ai/client'
import { captureException } from '@/lib/sentry'
import { scrapeReel, transcribeVideo } from '@/lib/reels/scrapeReel'

interface JobRow {
  id: string
  status: string
  payload: {
    url: string
    scope: 'system' | 'project'
    projectId: string | null
    niches: string[]
    createdBy: string
  }
}

// Runs a viral-reel job to completion in a single leg — scrape + transcribe +
// analysis comfortably fits inside maxDuration=300s, same reasoning as
// runInstagramScrapeJob.ts. The reliability win is the client no longer
// holding an SSE connection open across the whole ~30-60s pipeline.
export async function processViralReelJob(jobId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: job, error } = await admin.from('jobs').select('*').eq('id', jobId).single()
  if (error || !job) return
  const row = job as unknown as JobRow
  if (row.status === 'done' || row.status === 'error') return // already finished

  const apifyToken = process.env.APIFY_TOKEN
  const openaiKey  = process.env.OPENAI_API_KEY
  if (!apifyToken) {
    await admin.from('jobs').update({ status: 'error', error: 'APIFY_TOKEN не настроен' }).eq('id', jobId)
    return
  }

  await admin.from('jobs').update({ status: 'processing' }).eq('id', jobId)

  const { url, scope, projectId, niches, createdBy } = row.payload

  try {
    const reel = await scrapeReel(url, apifyToken)
    if (!reel.ok) throw new Error(reel.error ?? 'Не удалось загрузить рилз')

    let transcript = ''
    if (reel.videoUrl && openaiKey) {
      transcript = await transcribeVideo(reel.videoUrl, openaiKey)
    }

    const prompt = `Разбери залетевший Instagram рилз. Это реальный успешный референс, который нужно потом адаптировать другим блогерам.

ДАННЫЕ РИЛЗ:
Автор: @${reel.username}
Просмотры: ${reel.views} · Лайки: ${reel.likes} · Комментарии: ${reel.comments}
Подпись: ${reel.caption.slice(0, 1500) || '—'}
${transcript ? `Расшифровка речи в рилз:\n${transcript.slice(0, 3000)}` : '(речь не распознана — анализируй по подписи и цифрам)'}

Верни СТРОГО JSON без markdown:
{"reel_type":"короткое название формата (3-5 слов, напр. «хук-перевёртыш с личной цифрой»)","analysis":"разбор: какой хук в первые секунды, структура по сценам, почему зашло, что цепляет — 3-5 предложений живым языком","niches":["ниша1","ниша2"]}
- niches: 1-3 ниши, для которых этот рилз релевантен (напр. «продюсирование», «нутрициология», «фитнес»). Если универсально — оставь пустым [].`

    const resp = await anthropic.messages.create({
      model: MODEL, max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    })
    const raw = resp.content.map(b => (b.type === 'text' ? b.text : '')).join('\n')
    let parsed: { reel_type?: string; analysis?: string; niches?: string[] } = {}
    try { const m = raw.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]) } catch { /* keep empty */ }

    const finalNiches = scope === 'system'
      ? ((niches && niches.length > 0) ? niches : (parsed.niches ?? []))
      : (parsed.niches ?? [])

    const { error: insErr } = await admin.from('viral_reels').insert({
      scope,
      project_id: scope === 'project' ? projectId : null,
      created_by: createdBy,
      source_url: url,
      username:   reel.username || null,
      caption:    reel.caption || null,
      transcript: transcript || null,
      analysis:   parsed.analysis || null,
      reel_type:  parsed.reel_type || 'Виральный рилз',
      niches:     (finalNiches && finalNiches.length > 0) ? finalNiches : null,
      views:      reel.views || null,
      likes:      reel.likes || null,
      comments:   reel.comments || null,
      is_active:  true,
    })
    if (insErr) throw new Error(`Не удалось сохранить: ${insErr.message}`)

    await admin.from('jobs').update({
      status: 'done',
      result: { reel_type: parsed.reel_type, analysis: parsed.analysis },
    }).eq('id', jobId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка'
    console.error('[runViralReelJob] error:', msg)
    await admin.from('jobs').update({ status: 'error', error: msg }).eq('id', jobId)
    await captureException(err, { where: 'runViralReelJob', jobId, url })
  }
}
