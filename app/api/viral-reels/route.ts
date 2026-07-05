import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/client'
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

// Apify actor that accepts a direct reel/post URL
const APIFY_ACTOR = 'apify~instagram-scraper'
const WHISPER_MAX = 24 * 1024 * 1024

interface ScrapedReel {
  caption: string; videoUrl: string | null; views: number; likes: number
  comments: number; username: string; ok: boolean; error?: string
}

async function scrapeReel(url: string, token: string): Promise<ScrapedReel> {
  const empty: ScrapedReel = { caption: '', videoUrl: null, views: 0, likes: 0, comments: 0, username: '', ok: false }
  try {
    const api = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`
    const res = await fetch(api, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directUrls: [url], resultsType: 'posts', resultsLimit: 1, addParentData: false }),
      // Cap the Apify run so a hung actor can't burn the whole 300s function budget.
      signal: AbortSignal.timeout(80000),
    })
    if (!res.ok) return { ...empty, error: `Apify ${res.status}` }
    const data = await res.json() as unknown
    if (!Array.isArray(data) || data.length === 0) return { ...empty, error: 'Рилз не найден или приватный' }
    const r = data[0] as Record<string, unknown>
    const num = (...keys: string[]): number => { for (const k of keys) { const v = r[k]; if (typeof v === 'number') return v } return 0 }
    return {
      caption:  String(r.caption ?? r.text ?? ''),
      videoUrl: (r.videoUrl as string) ?? (r.videoUrlOriginal as string) ?? null,
      views:    num('videoViewCount', 'videoPlayCount', 'playsCount'),
      likes:    num('likesCount', 'likes'),
      comments: num('commentsCount', 'comments'),
      username: String(r.ownerUsername ?? r.username ?? ''),
      ok: true,
    }
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : 'scrape failed' }
  }
}

async function transcribeVideo(videoUrl: string, apiKey: string): Promise<string> {
  try {
    const vid = await fetch(videoUrl)
    if (!vid.ok) return ''
    // Skip BEFORE buffering the whole video into memory when the size is known
    // (avoids an OOM peak on the serverless function for big reels). Log the skip
    // so «нет транскрипта» is diagnosable instead of silent — analysis then falls
    // back to the caption, which is acceptable.
    const declared = Number(vid.headers.get('content-length') || 0)
    if (declared > WHISPER_MAX) {
      console.warn(`[viral-reels] video ${declared}B > Whisper cap ${WHISPER_MAX}B — пропускаю транскрипт, анализ по подписи`)
      return ''
    }
    const blob = await vid.blob()
    if (blob.size === 0) return ''
    if (blob.size > WHISPER_MAX) {
      console.warn(`[viral-reels] video ${blob.size}B > Whisper cap — пропускаю транскрипт, анализ по подписи`)
      return ''
    }
    const { default: OpenAI, toFile } = await import('openai')
    const openai = new OpenAI({ apiKey })
    const audio = await toFile(blob, 'reel.mp4', { type: blob.type || 'video/mp4' })
    const text = await openai.audio.transcriptions.create({
      file: audio, model: 'whisper-1', language: 'ru', response_format: 'text',
    })
    return (text as unknown as string).trim()
  } catch { return '' }
}

// ── GET: list reels (admin → system; user → their project's) ────────────────
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const scope = searchParams.get('scope') ?? 'project'
  const projectId = searchParams.get('projectId')

  let q = supabase.from('viral_reels').select('*').order('created_at', { ascending: false })
  if (scope === 'system') q = q.eq('scope', 'system')
  else { if (!projectId) return NextResponse.json({ reels: [] }); q = q.eq('scope', 'project').eq('project_id', projectId) }

  const { data, error } = await q
  if (error) {
    if (error.message?.includes('does not exist')) return NextResponse.json({ reels: [], needsMigration: true })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ reels: data ?? [] })
}

// ── DELETE ───────────────────────────────────────────────────────────────────
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabase.from('viral_reels').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// ── POST: scrape → transcribe → analyse → save (SSE-streamed) ───────────────
export async function POST(request: Request) {
  const apifyToken = process.env.APIFY_TOKEN
  const openaiKey  = process.env.OPENAI_API_KEY
  if (!apifyToken) return NextResponse.json({ error: 'APIFY_TOKEN не настроен' }, { status: 500 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'viral-reels')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  const body = await request.json().catch(() => ({})) as {
    url?: string; scope?: 'system' | 'project'; projectId?: string; niches?: string[]
  }
  const url   = (body.url ?? '').trim()
  const scope = body.scope === 'system' ? 'system' : 'project'
  if (!url || !/instagram\.com\/(reel|p|tv)\//.test(url)) {
    return NextResponse.json({ error: 'Вставь ссылку на Instagram рилз/пост' }, { status: 400 })
  }

  // Authorisation per scope
  if (scope === 'system') {
    const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (prof?.role !== 'admin') return NextResponse.json({ error: 'Только админ может добавлять общие референсы' }, { status: 403 })
  } else {
    if (!body.projectId) return NextResponse.json({ error: 'projectId обязателен' }, { status: 400 })
    const { data: proj } = await supabase.from('projects').select('id').eq('id', body.projectId).eq('owner_id', user.id).single()
    if (!proj) return NextResponse.json({ error: 'Проект не найден' }, { status: 404 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const push = (s: string) => { if (!closed) { try { controller.enqueue(encoder.encode(s)) } catch { closed = true } } }
      const send = (d: Record<string, unknown>) => push(`data: ${JSON.stringify(d)}\n\n`)
      push(': open\n\n')
      const ping = setInterval(() => push(': ping\n\n'), 10000)

      try {
        send({ type: 'status', message: 'Загружаю рилз из Instagram…' })
        const reel = await scrapeReel(url, apifyToken)
        if (!reel.ok) { send({ type: 'error', message: reel.error ?? 'Не удалось загрузить рилз' }); return }

        let transcript = ''
        if (reel.videoUrl && openaiKey) {
          send({ type: 'status', message: 'Расшифровываю что говорят в рилз…' })
          transcript = await transcribeVideo(reel.videoUrl, openaiKey)
        }

        send({ type: 'status', message: 'AI разбирает почему рилз зашёл…' })
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

        const niches = scope === 'system'
          ? ((body.niches && body.niches.length > 0) ? body.niches : (parsed.niches ?? []))
          : (parsed.niches ?? [])

        const { error: insErr } = await supabase.from('viral_reels').insert({
          scope,
          project_id: scope === 'project' ? body.projectId : null,
          created_by: user.id,
          source_url: url,
          username:   reel.username || null,
          caption:    reel.caption || null,
          transcript: transcript || null,
          analysis:   parsed.analysis || null,
          reel_type:  parsed.reel_type || 'Виральный рилз',
          niches:     (niches && niches.length > 0) ? niches : null,
          views:      reel.views || null,
          likes:      reel.likes || null,
          comments:   reel.comments || null,
          is_active:  true,
        })
        if (insErr) { send({ type: 'error', message: `Не удалось сохранить: ${insErr.message}` }); return }

        send({ type: 'done', reel_type: parsed.reel_type, analysis: parsed.analysis })
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : 'Ошибка' })
      } finally {
        clearInterval(ping); closed = true
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' },
  })
}
