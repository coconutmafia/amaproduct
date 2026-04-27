import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 60

// ── helpers ───────────────────────────────────────────────────────────────────
function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\\n/g, '\n').replace(/\\u([\dA-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\"/g, '"').trim()
}

// ── Telegram ──────────────────────────────────────────────────────────────────
async function scrapeTelegram(channel: string, target = 80): Promise<string[]> {
  const posts: string[] = []
  let beforeId: number | null = null

  for (let page = 0; page < 5 && posts.length < target; page++) {
    const url = beforeId ? `https://t.me/s/${channel}?before=${beforeId}` : `https://t.me/s/${channel}`
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'Accept-Language': 'ru,en;q=0.9' },
        signal: AbortSignal.timeout(12000),
      })
      if (!res.ok) { if (page === 0) throw new Error(`Telegram недоступен (${res.status}). Убедись что канал публичный.`); break }
      const html = await res.text()

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
    } catch (e) { if (page === 0) throw e; break }
  }
  return [...new Set(posts)].slice(0, target)
}

// ── Instagram ─────────────────────────────────────────────────────────────────
async function scrapeInstagram(username: string, target = 80): Promise<{ bio: string; posts: string[] }> {
  const posts: string[] = []
  let bio = ''

  // Method 1: internal API
  try {
    const res = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': '*/*', 'Accept-Language': 'ru,en;q=0.9',
        'x-ig-app-id': '936619743392459',
        'Referer': `https://www.instagram.com/${username}/`,
        'Origin': 'https://www.instagram.com',
      },
      signal: AbortSignal.timeout(12000),
    })
    if (res.ok) {
      const json = await res.json() as { data?: { user?: { id?: string; biography?: string; edge_owner_to_timeline_media?: { page_info?: { has_next_page?: boolean; end_cursor?: string }; edges?: Array<{ node?: { edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> } } }> } } } }
      const user = json?.data?.user
      if (user) {
        bio = user.biography ?? ''
        const userId = user.id ?? ''
        const media = user.edge_owner_to_timeline_media
        let cursor = media?.page_info?.end_cursor ?? ''
        let hasNext = media?.page_info?.has_next_page ?? false
        for (const e of (media?.edges ?? [])) {
          const cap = e.node?.edge_media_to_caption?.edges?.[0]?.node?.text
          if (cap && cap.length > 20) posts.push(cap)
        }
        // Paginate via GraphQL
        for (let p = 0; p < 4 && hasNext && cursor && posts.length < target; p++) {
          try {
            const vars = encodeURIComponent(JSON.stringify({ id: userId, first: 50, after: cursor }))
            const gr = await fetch(`https://www.instagram.com/graphql/query/?query_hash=e769aa130647d2354c40ea6a439bfc08&variables=${vars}`, {
              headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', 'x-ig-app-id': '936619743392459', 'Referer': `https://www.instagram.com/${username}/` },
              signal: AbortSignal.timeout(10000),
            })
            if (!gr.ok) break
            const gj = await gr.json() as { data?: { user?: { edge_owner_to_timeline_media?: { page_info?: { has_next_page?: boolean; end_cursor?: string }; edges?: Array<{ node?: { edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> } } }> } } } }
            const gm = gj?.data?.user?.edge_owner_to_timeline_media
            if (!gm) break
            cursor = gm.page_info?.end_cursor ?? ''; hasNext = gm.page_info?.has_next_page ?? false
            for (const e of (gm.edges ?? [])) {
              const cap = e.node?.edge_media_to_caption?.edges?.[0]?.node?.text
              if (cap && cap.length > 20) posts.push(cap)
            }
          } catch { break }
        }
        if (bio || posts.length > 0) return { bio, posts: [...new Set(posts)].slice(0, target) }
      }
    }
  } catch { /* fall through */ }

  // Method 2: HTML scrape
  try {
    const html = await fetch(`https://www.instagram.com/${username}/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'Accept-Language': 'ru,en;q=0.9' },
      signal: AbortSignal.timeout(12000),
    }).then(r => r.text())
    const bm = html.match(/"biography"\s*:\s*"([^"]*)"/)
    if (bm) bio = decodeHtml(bm[1])
    const re = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g; let cm: RegExpExecArray | null
    while ((cm = re.exec(html)) !== null && posts.length < 30) {
      const t = decodeHtml(cm[1])
      if (t.length > 40 && !t.includes('{"') && !t.startsWith('http')) posts.push(t)
    }
  } catch { /* ignore */ }

  if (!bio && posts.length === 0) throw new Error('Instagram заблокировал загрузку. Скопируй тексты постов и загрузи через «Материалы» вручную.')
  return { bio, posts: [...new Set(posts)].slice(0, target) }
}

// ── YouTube ───────────────────────────────────────────────────────────────────
async function scrapeYoutube(input: string, target = 50): Promise<{ description: string; videos: Array<{ title: string; desc: string }> }> {
  // Normalize: @username, channel URL, /c/name, /channel/UCxxx
  let channelUrl = input.trim()
  if (!channelUrl.startsWith('http')) {
    const handle = channelUrl.replace(/^@/, '')
    channelUrl = `https://www.youtube.com/@${handle}`
  }
  // Ensure /videos path for better data
  const baseUrl = channelUrl.replace(/\/(videos|about|shorts|playlists)?$/, '')

  const html = await fetch(`${baseUrl}/videos`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Accept-Language': 'ru,en;q=0.9',
    },
    signal: AbortSignal.timeout(15000),
  }).then(r => { if (!r.ok) throw new Error(`YouTube недоступен (${r.status})`); return r.text() })

  // Extract ytInitialData JSON
  const dataMatch = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/)
  if (!dataMatch) {
    // Fallback: extract titles with simple regex
    const titles: string[] = []
    const titleRe = /"title"\s*:\s*\{"runs"\s*:\s*\[\{"text"\s*:\s*"([^"]+)"/g
    let tm: RegExpExecArray | null
    while ((tm = titleRe.exec(html)) !== null && titles.length < target) {
      const t = decodeHtml(tm[1])
      if (t.length > 3 && !t.includes('YouTube')) titles.push(t)
    }
    const descMatch = html.match(/"description"\s*:\s*\{"simpleText"\s*:\s*"([^"]*)"/)
    const description = descMatch ? decodeHtml(descMatch[1]) : ''
    return { description, videos: titles.map(t => ({ title: t, desc: '' })) }
  }

  let data: Record<string, unknown>
  try { data = JSON.parse(dataMatch[1]) } catch { data = {} }

  // Get channel description
  const descMatch = JSON.stringify(data).match(/"description"\s*:\s*\{"simpleText"\s*:\s*"([^"]*)"/)
  const description = descMatch ? decodeHtml(descMatch[1]) : ''

  // Extract video titles and descriptions from ytInitialData
  const videos: Array<{ title: string; desc: string }> = []
  const json = JSON.stringify(data)

  // Video titles from videoRenderer
  const titleRe = /"videoRenderer".*?"title".*?"runs".*?"text"\s*:\s*"([^"]+)"/g
  const descRe = /"descriptionSnippet".*?"text"\s*:\s*"([^"]+)"/g
  const titles: string[] = []
  const descs: string[] = []

  let tm: RegExpExecArray | null
  while ((tm = titleRe.exec(json)) !== null && titles.length < target) {
    const t = decodeHtml(tm[1])
    if (t && !titles.includes(t)) titles.push(t)
  }
  let dm: RegExpExecArray | null
  while ((dm = descRe.exec(json)) !== null && descs.length < target) {
    descs.push(decodeHtml(dm[1]))
  }

  for (let i = 0; i < titles.length; i++) {
    videos.push({ title: titles[i], desc: descs[i] ?? '' })
  }

  return { description, videos }
}

// ── VK ────────────────────────────────────────────────────────────────────────
async function scrapeVK(input: string, target = 50): Promise<string[]> {
  // Normalize: @domain, https://vk.com/domain
  const domain = input.replace(/^@/, '').replace(/^https?:\/\/vk\.com\//, '').replace(/\/$/, '')

  const res = await fetch(`https://vk.com/${domain}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Accept-Language': 'ru,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(12000),
  })
  if (!res.ok) throw new Error(`VK страница недоступна (${res.status})`)

  const html = await res.text()
  const posts: string[] = []

  // VK embeds some wall posts in initial HTML for SEO
  // Look for post texts in og:description and structured data
  const ogDesc = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/)
  if (ogDesc) posts.push(decodeHtml(ogDesc[1]))

  // Look for post content in JSON-LD or script data
  const postRe = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g
  let pm: RegExpExecArray | null
  while ((pm = postRe.exec(html)) !== null && posts.length < target) {
    const t = decodeHtml(pm[1])
    if (t.length > 40 && !t.includes('function') && !t.startsWith('http') && !t.includes('\\u')) {
      posts.push(t)
    }
  }

  // Also try to find wall post blocks in static HTML
  const wallRe = /class="[^"]*post__text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
  let wm: RegExpExecArray | null
  while ((wm = wallRe.exec(html)) !== null && posts.length < target) {
    const t = decodeHtml(wm[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
    if (t.length > 40) posts.push(t)
  }

  if (posts.length === 0) throw new Error('VK страница не вернула текстов. Скорее всего страница приватная или VK заблокировал загрузку.')
  return [...new Set(posts)].slice(0, target)
}

// ── Username extractor ────────────────────────────────────────────────────────
function extractUsername(url: string): string {
  const clean = url.trim().replace(/\/$/, '')
  const match = clean.match(/(?:t\.me\/|instagram\.com\/|vk\.com\/|youtube\.com\/@?|@)([A-Za-z0-9_.-]+)/)
  return match ? match[1] : clean.replace(/^@/, '')
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { projectId, platform, username } = await request.json() as {
      projectId: string
      platform: 'telegram' | 'instagram' | 'youtube' | 'vk'
      username: string
    }

    if (!projectId || !platform || !username) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

    const { data: project } = await supabase.from('projects').select('id').eq('id', projectId).eq('owner_id', user.id).single()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    let contentText = ''
    let postsCount = 0
    const platformLabels: Record<string, string> = { telegram: 'Telegram', instagram: 'Instagram', youtube: 'YouTube', vk: 'VK' }
    const label = platformLabels[platform] ?? platform

    if (platform === 'telegram') {
      const posts = await scrapeTelegram(username, 80)
      if (posts.length === 0) return NextResponse.json({ error: 'Постов не найдено. Убедись что канал публичный.' }, { status: 422 })
      postsCount = posts.length
      contentText = `Telegram-канал @${username}\n\nПоследние ${postsCount} постов:\n\n` + posts.map((p, i) => `--- Пост ${i + 1} ---\n${p}`).join('\n\n')

    } else if (platform === 'instagram') {
      const { bio, posts } = await scrapeInstagram(username, 80)
      postsCount = posts.length + (bio ? 1 : 0)
      contentText = `Instagram @${username}\n\n`
      if (bio) contentText += `Описание профиля:\n${bio}\n\n`
      if (posts.length > 0) contentText += `Последние ${posts.length} постов:\n\n` + posts.map((p, i) => `--- Пост ${i + 1} ---\n${p}`).join('\n\n')

    } else if (platform === 'youtube') {
      const { description, videos } = await scrapeYoutube(username, 50)
      postsCount = videos.length + (description ? 1 : 0)
      contentText = `YouTube канал: ${username}\n\n`
      if (description) contentText += `Описание канала:\n${description}\n\n`
      if (videos.length > 0) {
        contentText += `Последние ${videos.length} видео:\n\n` + videos.map((v, i) =>
          `--- Видео ${i + 1} ---\nНазвание: ${v.title}${v.desc ? `\nОписание: ${v.desc}` : ''}`
        ).join('\n\n')
      }

    } else if (platform === 'vk') {
      const posts = await scrapeVK(username, 50)
      postsCount = posts.length
      contentText = `VK страница: ${username}\n\nПосты:\n\n` + posts.map((p, i) => `--- Пост ${i + 1} ---\n${p}`).join('\n\n')
    }

    if (!contentText) return NextResponse.json({ error: 'Не удалось загрузить контент' }, { status: 422 })

    // Replace old scrape for this platform
    await supabase.from('project_materials').delete()
      .eq('project_id', projectId).eq('material_type', 'other')
      .ilike('title', `%${label}%`)

    const { error: insertError } = await supabase.from('project_materials').insert({
      project_id: projectId,
      material_type: 'other',
      title: `${label} @${extractUsername(username)}`,
      raw_content: contentText,
      processing_status: 'ready',
    })
    if (insertError) throw insertError

    console.log(`[scrape-social] ${platform} @${username} → ${postsCount} items, project=${projectId}`)

    return NextResponse.json({
      success: true,
      postsCount,
      message: `Загружено ${postsCount} материалов из ${label} — AI проанализировал профиль`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка загрузки'
    console.error('[scrape-social] Error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
