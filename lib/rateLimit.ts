// Server-only. Per-user hourly caps on endpoints that spend real money
// (Claude / Apify / Whisper / gpt-image-1). Wallet safety net independent of
// billing quotas — active even while BILLING_ENFORCED is off.
//
// Design: fail-OPEN everywhere (missing migration, RPC error, network hiccup →
// allow) — a rate limiter must never take the product down. Admins bypass, but
// the admin check runs ONLY when a block would happen, so the hot path costs a
// single RPC.
import { createClient } from '@/lib/supabase/server'

const HOUR = 3600

// Caps chosen ~5-10× above heavy LEGITIMATE hourly use, so real users never
// see them and a runaway script/abuser is contained.
const LIMITS: Record<string, { limit: number; windowSeconds: number }> = {
  chat:           { limit: 60,  windowSeconds: HOUR }, // chat turns incl. edits
  generate:       { limit: 40,  windowSeconds: HOUR },
  'plan-stories': { limit: 20,  windowSeconds: HOUR },
  image:          { limit: 20,  windowSeconds: HOUR }, // gpt-image-1 = real $
  transcribe:     { limit: 120, windowSeconds: HOUR }, // per CHUNK; 120 ≈ 20h of audio
  scrape:         { limit: 10,  windowSeconds: HOUR }, // Apify runs
  'viral-reels':  { limit: 10,  windowSeconds: HOUR }, // Apify + Whisper + Claude
  video:          { limit: 10,  windowSeconds: HOUR }, // ffmpeg overlay
  autofill:       { limit: 10,  windowSeconds: HOUR },
  'scrape-product': { limit: 20, windowSeconds: HOUR },
  'blog-audit':   { limit: 20,  windowSeconds: HOUR }, // 1 Claude call, no Apify
  'blog-audit-standalone': { limit: 10, windowSeconds: HOUR }, // Apify-скрейп + Claude
  // Wallet guards for expensive AI / Whisper routes (Claude / OpenAI = real $).
  'analyze-competitors': { limit: 15, windowSeconds: HOUR }, // до 4× flagship
  'suggest-trends': { limit: 20, windowSeconds: HOUR }, // web-search + flagship
  'research-analyze': { limit: 15, windowSeconds: HOUR }, // N× flagship + embed
  'warmup-plan': { limit: 20, windowSeconds: HOUR }, // flagship-стрим
  'generate-week-brief': { limit: 30, windowSeconds: HOUR },
  'suggest-angles': { limit: 30, windowSeconds: HOUR },
  'carousel-structure': { limit: 40, windowSeconds: HOUR },
  edit:           { limit: 60,  windowSeconds: HOUR }, // edit + edit-carousel + edit-stories
  'post-hook':    { limit: 40,  windowSeconds: HOUR },
  'brand-kit':    { limit: 20,  windowSeconds: HOUR }, // Claude-vision
  'extract-tone': { limit: 30,  windowSeconds: HOUR }, // flagship-стрим
}

export interface RateLimitResult {
  allowed: boolean
  message?: string
}

export async function rateLimit(userId: string, bucket: string): Promise<RateLimitResult> {
  try {
    const cfg = LIMITS[bucket] ?? { limit: 30, windowSeconds: HOUR }
    const supabase = await createClient()

    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_user_id: userId,
      p_bucket: bucket,
      p_limit: cfg.limit,
      p_window_seconds: cfg.windowSeconds,
    })
    if (error) {
      // Migration not applied yet / transient DB issue — never block on infra.
      console.warn(`[rateLimit] rpc failed (fail-open) bucket=${bucket}:`, error.message)
      return { allowed: true }
    }
    if (data === false) {
      // Would block — admins bypass (checked only here to keep hot path cheap).
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', userId).single()
      if (prof?.role === 'admin') return { allowed: true }
      console.warn(`[rateLimit] BLOCKED user=${userId} bucket=${bucket} (> ${cfg.limit}/${cfg.windowSeconds}s)`)
      return {
        allowed: false,
        message: 'Слишком много запросов подряд — сделай небольшую паузу. Лимит обновится в течение часа.',
      }
    }
    return { allowed: true }
  } catch (e) {
    console.warn('[rateLimit] failed (fail-open):', e instanceof Error ? e.message : e)
    return { allowed: true }
  }
}
