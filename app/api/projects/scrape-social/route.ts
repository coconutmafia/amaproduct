import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 60 // Vercel Pro allows up to 300s; 60s is enough for pagination

// ── Telegram: paginated scraper ───────────────────────────────────────────────
// t.me/s/{channel}?before={msg_id} gives older posts — we walk back page by page
async function scrapeTelegram(channel: string, targetCount = 80): Promise<string[]> {
  const posts: string[] = []
  let beforeId: number | null = null
  const maxPages = 5

  for (let page = 0; page < maxPages && posts.length < targetCount; page++) {
    const url = beforeId
      ? `https://t.me/s/${channel}?before=${beforeId}`
      : `https://t.me/s/${channel}`

    let html: string
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
          'Accept-Language': 'ru,en;q=0.9',
        },
        signal: AbortSignal.timeout(12000),
      })
      if (!res.ok) {
        if (page === 0) throw new Error(`Telegram канал недоступен (${res.status}). Убедись что канал публичный.`)
        break // subsequent pages — just stop
      }
      html = await res.text()
    } catch (e) {
      if (page === 0) throw e
      break
    }

    // Extract post texts
    const blockRe = /<div[^>]+class="[^"]*tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
    let match: RegExpExecArray | null
    const pagePosts: string[] = []

    while ((match = blockRe.exec(html)) !== null) {
      const raw = match[1]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
        .trim()
      if (raw.length > 30) pagePosts.push(raw)
    }

    if (pagePosts.length === 0) break // no more content

    posts.push(...pagePosts)

    // Find minimum message ID on this page for next iteration
    const idMatches = [...html.matchAll(/data-post="[^/]+\/(\d+)"/g)]
    if (idMatches.length === 0) break
    const ids = idMatches.map(m => parseInt(m[1], 10)).filter(n => !isNaN(n))
    if (ids.length === 0) break
    beforeId = Math.min(...ids)
  }

  // Deduplicate (same post can appear across pages)
  return [...new Set(posts)].slice(0, targetCount)
}

// ── Instagram: paginated scraper ──────────────────────────────────────────────
async function scrapeInstagram(username: string, targetCount = 80): Promise<{ bio: string; posts: string[] }> {
  const posts: string[] = []
  let bio = ''
  let userId = ''
  let endCursor = ''
  let hasNextPage = true

  // ── Attempt 1: Internal API (most reliable for public accounts) ──────────
  const apiUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`
  try {
    const res = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': '*/*',
        'Accept-Language': 'ru,en;q=0.9',
        'x-ig-app-id': '936619743392459',
        'Referer': `https://www.instagram.com/${username}/`,
        'Origin': 'https://www.instagram.com',
      },
      signal: AbortSignal.timeout(12000),
    })

    if (res.ok) {
      const json = await res.json() as {
        data?: {
          user?: {
            id?: string
            biography?: string
            edge_owner_to_timeline_media?: {
              page_info?: { has_next_page?: boolean; end_cursor?: string }
              edges?: Array<{ node?: { edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> } } }>
            }
          }
        }
      }
      const user = json?.data?.user
      if (user) {
        bio = user.biography ?? ''
        userId = user.id ?? ''
        const media = user.edge_owner_to_timeline_media
        endCursor = media?.page_info?.end_cursor ?? ''
        hasNextPage = media?.page_info?.has_next_page ?? false

        for (const edge of (media?.edges ?? [])) {
          const caption = edge.node?.edge_media_to_caption?.edges?.[0]?.node?.text
          if (caption && caption.length > 20) posts.push(caption)
        }

        // Paginate via GraphQL if we have userId and cursor
        if (userId && hasNextPage && endCursor && posts.length < targetCount) {
          const maxExtraPages = 4
          for (let p = 0; p < maxExtraPages && hasNextPage && posts.length < targetCount; p++) {
            try {
              const vars = encodeURIComponent(JSON.stringify({ id: userId, first: 50, after: endCursor }))
              const gqlRes = await fetch(
                `https://www.instagram.com/graphql/query/?query_hash=e769aa130647d2354c40ea6a439bfc08&variables=${vars}`,
                {
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
                    'x-ig-app-id': '936619743392459',
                    'Referer': `https://www.instagram.com/${username}/`,
                  },
                  signal: AbortSignal.timeout(10000),
                }
              )
              if (!gqlRes.ok) break
              const gqlJson = await gqlRes.json() as {
                data?: {
                  user?: {
                    edge_owner_to_timeline_media?: {
                      page_info?: { has_next_page?: boolean; end_cursor?: string }
                      edges?: Array<{ node?: { edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> } } }>
                    }
                  }
                }
              }
              const gqlMedia = gqlJson?.data?.user?.edge_owner_to_timeline_media
              if (!gqlMedia) break
              endCursor = gqlMedia.page_info?.end_cursor ?? ''
              hasNextPage = gqlMedia.page_info?.has_next_page ?? false
              for (const edge of (gqlMedia.edges ?? [])) {
                const caption = edge.node?.edge_media_to_caption?.edges?.[0]?.node?.text
                if (caption && caption.length > 20) posts.push(caption)
              }
            } catch { break }
          }
        }

        if (bio || posts.length > 0) {
          return { bio, posts: [...new Set(posts)].slice(0, targetCount) }
        }
      }
    }
  } catch { /* fall through */ }

  // ── Attempt 2: HTML scrape (fallback) ────────────────────────────────────
  try {
    const pageRes = await fetch(`https://www.instagram.com/${username}/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept-Language': 'ru,en;q=0.9',
      },
      signal: AbortSignal.timeout(12000),
    })

    if (pageRes.ok) {
      const html = await pageRes.text()
      const bioMatch = html.match(/"biography"\s*:\s*"([^"]*)"/)
      if (bioMatch) bio = bioMatch[1].replace(/\\n/g, '\n')

      const captionRe = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g
      let cm: RegExpExecArray | null
      while ((cm = captionRe.exec(html)) !== null && posts.length < 30) {
        const text = cm[1]
          .replace(/\\n/g, '\n')
          .replace(/\\u([\dA-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
          .replace(/\\"/g, '"').trim()
        if (text.length > 40 && !text.includes('{"') && !text.startsWith('http')) {
          posts.push(text)
        }
      }
    }
  } catch { /* ignore */ }

  if (!bio && posts.length === 0) {
    throw new Error(
      'Instagram заблокировал автоматическую загрузку. ' +
      'Скопируй тексты своих постов и загрузи через «Материалы» вручную — это займёт 2 минуты.'
    )
  }

  return { bio, posts: [...new Set(posts)].slice(0, targetCount) }
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { projectId, platform, username } = await request.json() as {
      projectId: string
      platform: 'telegram' | 'instagram'
      username: string
    }

    if (!projectId || !platform || !username) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    const { data: project } = await supabase
      .from('projects').select('id').eq('id', projectId).eq('owner_id', user.id).single()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    let contentText = ''
    let postsCount = 0

    if (platform === 'telegram') {
      const posts = await scrapeTelegram(username, 80)
      if (posts.length === 0) {
        return NextResponse.json({ error: 'Постов не найдено. Убедись что канал публичный.' }, { status: 422 })
      }
      postsCount = posts.length
      contentText = `Telegram-канал @${username}\n\nПоследние ${postsCount} постов:\n\n` +
        posts.map((p, i) => `--- Пост ${i + 1} ---\n${p}`).join('\n\n')
    } else {
      const { bio, posts } = await scrapeInstagram(username, 80)
      postsCount = posts.length + (bio ? 1 : 0)
      contentText = `Instagram @${username}\n\n`
      if (bio) contentText += `Описание профиля:\n${bio}\n\n`
      if (posts.length > 0) {
        contentText += `Последние ${posts.length} постов:\n\n` +
          posts.map((p, i) => `--- Пост ${i + 1} ---\n${p}`).join('\n\n')
      }
    }

    // Replace old scrape for this platform
    await supabase
      .from('project_materials').delete()
      .eq('project_id', projectId).eq('material_type', 'other')
      .ilike('title', `%${platform === 'telegram' ? 'Telegram' : 'Instagram'}%`)

    const { error: insertError } = await supabase.from('project_materials').insert({
      project_id: projectId,
      material_type: 'other',
      title: platform === 'telegram' ? `Telegram @${username}` : `Instagram @${username}`,
      raw_content: contentText,
      processing_status: 'ready',
    })
    if (insertError) throw insertError

    console.log(`[scrape-social] ${platform} @${username} → ${postsCount} posts, project=${projectId}`)

    return NextResponse.json({
      success: true,
      postsCount,
      message: `Загружено ${postsCount} постов из ${platform === 'telegram' ? 'Telegram' : 'Instagram'} — AI проанализировал профиль`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка загрузки'
    console.error('[scrape-social] Error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
