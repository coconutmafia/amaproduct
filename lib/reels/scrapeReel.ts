// Shared Apify-scrape + Whisper-transcribe logic for a single Instagram reel,
// used by the background job runner (lib/jobs/runViralReelJob.ts). Extracted
// from app/api/viral-reels/route.ts when its POST handler moved to the jobs
// pattern (roadmap #8 style).

// Apify actor that accepts a direct reel/post URL
export const APIFY_ACTOR = 'apify~instagram-scraper'
const WHISPER_MAX = 24 * 1024 * 1024

export interface ScrapedReel {
  caption: string; videoUrl: string | null; views: number; likes: number
  comments: number; username: string; ok: boolean; error?: string
}

export async function scrapeReel(url: string, token: string): Promise<ScrapedReel> {
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

export async function transcribeVideo(videoUrl: string, apiKey: string): Promise<string> {
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
