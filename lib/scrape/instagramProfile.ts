// Shared Instagram profile scraper — Apify-first, with best-effort fallbacks.
//
// Instagram blocks direct/mirror scraping from datacenter IPs (Vercel), so on
// production the direct methods almost always fail. Apify runs from residential
// infra and is the reliable path (same actor as /api/instagram/scrape). Both the
// onboarding autofill (form prefill) and scrape-social (persists the profile as a
// project material) use THIS module so the owner's own Instagram reliably reaches
// generation — a broken scrape here silently drops the `my_instagram` link.

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\\n/g, '\n').replace(/\\u([\dA-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\"/g, '"').trim()
}

export interface InstagramProfile { bio: string; posts: string[] }

/**
 * Scrape a public Instagram profile's bio + recent post captions.
 * @param username bare handle (NOT a URL — normalize with extractUsername first)
 * @param target   max posts to return
 */
export async function scrapeInstagramProfile(username: string, target = 30): Promise<InstagramProfile> {
  const posts: string[] = []
  let bio = ''
  const cap = (t: string | undefined | null) => typeof t === 'string' && t.length > 20

  // ── Method 0 (PRIMARY): Apify official profile scraper ──────────────────────
  const apifyToken = process.env.APIFY_TOKEN
  if (apifyToken) {
    try {
      const res = await fetch(
        `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?token=${encodeURIComponent(apifyToken)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usernames: [username], resultsLimit: Math.min(target, 50) }),
          signal: AbortSignal.timeout(80000),
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
            const c = (pst.caption as string) || (pst.text as string) || ''
            if (cap(c)) posts.push(c)
          }
          if (bio || posts.length > 0) return { bio, posts: [...new Set(posts)].slice(0, target) }
        }
      } else {
        console.warn('[instagramProfile] Apify failed:', res.status)
      }
    } catch (e) {
      console.warn('[instagramProfile] Apify error:', e instanceof Error ? e.message : e)
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
      },
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
          const c = e.node?.edge_media_to_caption?.edges?.[0]?.node?.text
          if (cap(c) && !posts.includes(c as string)) posts.push(c as string)
        }
        if (bio || posts.length > 0) return { bio, posts: posts.slice(0, target) }
      }
    }
  } catch { /* fall through */ }

  // ── Method 2: picuki.com public mirror ──────────────────────────────────────
  try {
    const html = await fetch(`https://www.picuki.com/profile/${username}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept-Language': 'ru,en;q=0.9', 'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(12000),
    }).then(r => { if (!r.ok) throw new Error(`picuki ${r.status}`); return r.text() })

    if (!bio) {
      const bm = html.match(/<div[^>]+class="[^"]*profile-description[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
        || html.match(/<span[^>]+class="[^"]*biography[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
      if (bm) bio = decodeHtml(bm[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    }
    const captionRe = /<div[^>]+class="[^"]*photo-description[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
    let m: RegExpExecArray | null
    while ((m = captionRe.exec(html)) !== null && posts.length < target) {
      const t = decodeHtml(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
      if (t.length > 30 && !posts.includes(t)) posts.push(t)
    }
    if (bio || posts.length > 0) return { bio, posts }
  } catch { /* fall through */ }

  // ── Method 3: Direct HTML (og:description at least yields the bio) ───────────
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
    while ((cm = re.exec(html)) !== null && posts.length < target) {
      const t = decodeHtml(cm[1])
      if (t.length > 40 && !t.includes('{"') && !t.startsWith('http') && !posts.includes(t)) posts.push(t)
    }
  } catch { /* ignore */ }

  return { bio, posts: posts.slice(0, target) }
}
