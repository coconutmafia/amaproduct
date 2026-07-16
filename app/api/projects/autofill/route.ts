import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { rateLimit } from '@/lib/rateLimit'
import { requirePaidAccess } from '@/lib/billing/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 90 // Apify profile scrape can take up to ~60-80s on cold start

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\\n/g, '\n').replace(/\\u([\dA-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\"/g, '"').trim()
}

function extractUsername(url: string): { username: string; platform: string } {
  const clean = url.trim().replace(/\/$/, '').toLowerCase()
  if (clean.includes('t.me/') || clean.includes('telegram')) {
    const m = clean.match(/t\.me\/([A-Za-z0-9_]+)/) || clean.match(/@([A-Za-z0-9_]+)/)
    return { username: m ? m[1] : clean.replace('@', ''), platform: 'telegram' }
  }
  if (clean.includes('instagram.com') || clean.includes('instagram')) {
    const m = clean.match(/instagram\.com\/([A-Za-z0-9_.]+)/) || clean.match(/@([A-Za-z0-9_.]+)/)
    return { username: m ? m[1] : clean.replace('@', ''), platform: 'instagram' }
  }
  if (clean.includes('youtube.com') || clean.includes('youtu.be')) {
    const m = clean.match(/youtube\.com\/@?([A-Za-z0-9_.-]+)/)
    return { username: m ? m[1] : clean, platform: 'youtube' }
  }
  if (clean.includes('vk.com')) {
    const m = clean.match(/vk\.com\/([A-Za-z0-9_]+)/)
    return { username: m ? m[1] : clean, platform: 'vk' }
  }
  // Fallback: try to guess platform from @handle
  if (clean.startsWith('@')) {
    return { username: clean.replace('@', ''), platform: 'telegram' }
  }
  return { username: clean, platform: 'telegram' }
}

async function scrapeTelegram(channel: string): Promise<{ bio: string; posts: string[] }> {
  const posts: string[] = []
  let bio = ''
  let beforeId: number | null = null

  for (let page = 0; page < 3 && posts.length < 30; page++) {
    const url = beforeId
      ? `https://t.me/s/${channel}?before=${beforeId}`
      : `https://t.me/s/${channel}`
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'Accept-Language': 'ru,en;q=0.9' },
        signal: AbortSignal.timeout(12000),
      })
      if (!res.ok) break
      const html = await res.text()

      // Extract channel description
      if (!bio) {
        const descMatch = html.match(/<div[^>]+class="[^"]*tgme_channel_info_description[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
        if (descMatch) bio = decodeHtml(descMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
      }

      const blockRe = /<div[^>]+class="[^"]*tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
      let m: RegExpExecArray | null
      const pagePosts: string[] = []
      while ((m = blockRe.exec(html)) !== null) {
        const raw = m[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
        const text = decodeHtml(raw)
        if (text.length > 30) pagePosts.push(text)
      }
      if (pagePosts.length === 0) break
      posts.push(...pagePosts)
      const ids = [...html.matchAll(/data-post="[^/]+\/(\d+)"/g)].map(x => parseInt(x[1], 10)).filter(n => !isNaN(n))
      if (ids.length === 0) break
      beforeId = Math.min(...ids)
    } catch { break }
  }
  return { bio, posts: [...new Set(posts)].slice(0, 30) }
}

async function scrapeInstagram(username: string, apifyTimeoutMs = 80000): Promise<{ bio: string; posts: string[] }> {
  const posts: string[] = []
  let bio = ''

  // ── Method 0 (PRIMARY): Apify official profile scraper ───────────────────────
  // Methods 1-5 below scrape Instagram/mirrors directly, which Instagram blocks
  // from datacenter IPs (Vercel) — so on production they almost always fail and
  // the user wrongly sees «проверь, что аккаунт публичный». Apify runs from
  // residential infra and is the same reliable path used by /api/instagram/scrape.
  // Falls through to best-effort methods if the token is missing or Apify errors.
  const apifyToken = process.env.APIFY_TOKEN
  if (!apifyToken) console.warn('[autofill] APIFY_TOKEN не настроен — надёжный Apify-путь IG отключён, работают только хрупкие фолбэки (IG блокирует их с серверных IP)')
  if (apifyToken) {
    try {
      const res = await fetch(
        `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?token=${encodeURIComponent(apifyToken)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usernames: [username], resultsLimit: 20 }),
          // Adaptive budget (caller decides): 80s when IG is the only source
          // (Apify cold start runs 60-80s), tighter when Telegram already ate
          // part of the 90s maxDuration.
          signal: AbortSignal.timeout(apifyTimeoutMs),
        },
      )
      if (res.ok) {
        const data = (await res.json()) as Array<Record<string, unknown>>
        const prof = Array.isArray(data) ? data[0] : undefined
        if (prof) {
          bio = (prof.biography as string) || ''
          const latest =
            (prof.latestPosts as Array<Record<string, unknown>>) ||
            (prof.posts as Array<Record<string, unknown>>) || []
          for (const pst of latest) {
            const cap = (pst.caption as string) || (pst.text as string) || ''
            if (cap && cap.length > 20) posts.push(cap)
          }
          if (bio || posts.length > 0) return { bio, posts: posts.slice(0, 20) }
        }
      } else {
        console.warn('[autofill] Apify IG failed:', res.status)
      }
    } catch (e) {
      console.warn('[autofill] Apify IG error:', e instanceof Error ? e.message : e)
    }
  }

  // ── Method 1: Instagram internal API ────────────────────────────────────────
  try {
    const res = await fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
          'Accept': 'application/json', 'Accept-Language': 'ru,en;q=0.9',
          'x-ig-app-id': '936619743392459',
          'x-requested-with': 'XMLHttpRequest',
          'Referer': `https://www.instagram.com/${username}/`,
          'Origin': 'https://www.instagram.com',
        },
        signal: AbortSignal.timeout(10000),
      }
    )
    if (res.ok) {
      const json = await res.json() as {
        data?: { user?: {
          biography?: string
          edge_owner_to_timeline_media?: { edges?: Array<{ node?: { edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> } } }> }
        } }
      }
      const user = json?.data?.user
      if (user) {
        bio = user.biography ?? ''
        for (const e of (user.edge_owner_to_timeline_media?.edges ?? [])) {
          const cap = e.node?.edge_media_to_caption?.edges?.[0]?.node?.text
          if (cap && cap.length > 20) posts.push(cap)
        }
        if (bio || posts.length > 0) return { bio, posts: posts.slice(0, 20) }
      }
    }
  } catch { /* fall through */ }

  // ── Method 2: ?__a=1 lightweight endpoint ────────────────────────────────────
  try {
    const res = await fetch(`https://www.instagram.com/${username}/?__a=1&__d=dis`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)',
        'Accept': 'application/json', 'Accept-Language': 'ru,en;q=0.9',
        'Referer': 'https://www.instagram.com/',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (res.ok) {
      const json = await res.json() as {
        graphql?: { user?: { biography?: string; edge_owner_to_timeline_media?: { edges?: Array<{ node?: { edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> } } }> } } }
      }
      const user = json?.graphql?.user
      if (user) {
        if (!bio) bio = user.biography ?? ''
        for (const e of (user.edge_owner_to_timeline_media?.edges ?? [])) {
          const cap = e.node?.edge_media_to_caption?.edges?.[0]?.node?.text
          if (cap && cap.length > 20 && !posts.includes(cap)) posts.push(cap)
        }
        if (bio || posts.length > 0) return { bio, posts: posts.slice(0, 20) }
      }
    }
  } catch { /* fall through */ }

  // ── Method 3: picuki.com public mirror ───────────────────────────────────────
  try {
    const html = await fetch(`https://www.picuki.com/profile/${username}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept-Language': 'ru,en;q=0.9',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(12000),
    }).then(r => { if (!r.ok) throw new Error(`picuki ${r.status}`); return r.text() })

    // Bio
    if (!bio) {
      const bm = html.match(/<div[^>]+class="[^"]*profile-description[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
        || html.match(/<span[^>]+class="[^"]*biography[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
      if (bm) bio = decodeHtml(bm[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    }
    // Post captions
    const captionRe = /<div[^>]+class="[^"]*photo-description[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
    let m: RegExpExecArray | null
    while ((m = captionRe.exec(html)) !== null && posts.length < 20) {
      const t = decodeHtml(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
      if (t.length > 30 && !posts.includes(t)) posts.push(t)
    }
    if (bio || posts.length > 0) return { bio, posts }
  } catch { /* fall through */ }

  // ── Method 4: imginn.com public mirror ───────────────────────────────────────
  try {
    const html = await fetch(`https://imginn.com/${username}/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept-Language': 'ru,en;q=0.9',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(12000),
    }).then(r => { if (!r.ok) throw new Error(`imginn ${r.status}`); return r.text() })

    // Bio
    if (!bio) {
      const bm = html.match(/<p[^>]+class="[^"]*desc[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
        || html.match(/"description"\s*:\s*"([^"]+)"/)
      if (bm) bio = decodeHtml(bm[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    }
    // Captions
    const capRe = /<p[^>]+class="[^"]*item-description[^"]*"[^>]*>([\s\S]*?)<\/p>/gi
    let m: RegExpExecArray | null
    while ((m = capRe.exec(html)) !== null && posts.length < 20) {
      const t = decodeHtml(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
      if (t.length > 30 && !posts.includes(t)) posts.push(t)
    }
    if (bio || posts.length > 0) return { bio, posts }
  } catch { /* fall through */ }

  // ── Method 5: Direct HTML scrape (og:description at least gives bio) ─────────
  try {
    const html = await fetch(`https://www.instagram.com/${username}/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept-Language': 'ru,en;q=0.9',
      },
      signal: AbortSignal.timeout(12000),
    }).then(r => r.text())

    if (!bio) {
      const bm = html.match(/"biography"\s*:\s*"([^"]*)"/)
        || html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/)
      if (bm) bio = decodeHtml(bm[1])
    }
    const re = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g
    let cm: RegExpExecArray | null
    while ((cm = re.exec(html)) !== null && posts.length < 20) {
      const t = decodeHtml(cm[1])
      if (t.length > 40 && !t.includes('{"') && !t.startsWith('http') && !posts.includes(t)) posts.push(t)
    }
  } catch { /* ignore */ }

  return { bio, posts: posts.slice(0, 20) }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await rateLimit(user.id, 'autofill')
    if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

    const denied = await requirePaidAccess(user.id)
    if (denied) return denied

    // Accept both URLs — try each until one works
    const body = await request.json() as { url?: string; instagramUrl?: string; telegramUrl?: string }
    const instagramRaw = (body.instagramUrl || (body.url && body.url.includes('instagram') ? body.url : '') || '').trim()
    const telegramRaw  = (body.telegramUrl  || (body.url && (body.url.includes('t.me') || body.url.includes('telegram')) ? body.url : '') || '').trim()

    if (!instagramRaw && !telegramRaw) {
      return NextResponse.json({ error: 'Укажи ссылку на Instagram или Telegram' }, { status: 400 })
    }

    let bio = ''
    let posts: string[] = []
    let platformLabel = ''

    // Try Telegram first — more reliable (public web viewer t.me/s/)
    if (telegramRaw) {
      try {
        const { username } = extractUsername(telegramRaw)
        const result = await scrapeTelegram(username)
        if (result.bio || result.posts.length > 0) {
          bio = result.bio
          posts = result.posts
          platformLabel = `Telegram @${username}`
        }
      } catch (e) {
        console.warn('[autofill] Telegram failed:', e instanceof Error ? e.message : e)
      }
    }

    // Try Instagram as fallback (or primary if no Telegram)
    if (!platformLabel && instagramRaw) {
      try {
        const { username } = extractUsername(instagramRaw)
        // Full 80s Apify budget when IG is the only source; tighter when the
        // Telegram scrape already consumed part of the 90s function budget.
        const result = await scrapeInstagram(username, telegramRaw ? 55000 : 80000)
        if (result.bio || result.posts.length > 0) {
          bio = result.bio
          posts = result.posts
          platformLabel = `Instagram @${username}`
        }
      } catch (e) {
        console.warn('[autofill] Instagram failed:', e instanceof Error ? e.message : e)
      }
    }

    if (!bio && posts.length === 0) {
      const tried = [telegramRaw && 'Telegram', instagramRaw && 'Instagram'].filter(Boolean).join(' и ')
      // Honest message: usually it's a temporary block / private account, not the
      // user's fault. Always offer the manual path so onboarding is never a dead end.
      return NextResponse.json({
        error: `Не удалось автоматически загрузить данные из ${tried} (профиль закрыт или сервис временно недоступен). Ничего страшного — можно заполнить поля вручную ниже.`,
      }, { status: 422 })
    }

    // Build content for AI analysis
    const samplePosts = posts.slice(0, 12).join('\n\n---\n\n')
    const content = [
      bio ? `Описание профиля: ${bio}` : '',
      posts.length > 0 ? `Примеры постов:\n\n${samplePosts}` : '',
    ].filter(Boolean).join('\n\n')

    // Analyze with Claude
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const aiResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Ты анализируешь публичный профиль блогера из ${platformLabel}.

Вот данные профиля:
${content}

Вырази точно и кратко на основе ТОЛЬКО этих данных. Верни JSON:
{
  "niche": "Тема/ниша блога (1-2 предложения, конкретно)",
  "description": "Свободное описание: о чём пишет, как себя позиционирует, стиль общения с аудиторией (2-4 предложения)",
  "target_audience": "Целевая аудитория: пол, возраст, боли, желания (2-3 предложения)",
  "content_goals": "Цели контента: что транслирует, к чему ведёт аудиторию (1-2 предложения)"
}

Если данных недостаточно для какого-то поля — напиши пустую строку "".
Верни ТОЛЬКО JSON, без пояснений.`,
      }],
    })

    const rawText = aiResponse.content[0].type === 'text' ? aiResponse.content[0].text : ''
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Не удалось проанализировать профиль' }, { status: 500 })
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      niche?: string
      description?: string
      target_audience?: string
      content_goals?: string
    }

    return NextResponse.json({
      success: true,
      platform: platformLabel,
      niche: parsed.niche || '',
      description: parsed.description || '',
      target_audience: parsed.target_audience || '',
      content_goals: parsed.content_goals || '',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка анализа'
    console.error('[autofill] Error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
