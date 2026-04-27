import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 30

// ── Telegram public channel scraper ─────────────────────────────────────────
// Reads https://t.me/s/{channel} — public HTML page, no auth needed
async function scrapeTelegram(channel: string): Promise<string[]> {
  const url = `https://t.me/s/${channel}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Accept-Language': 'ru,en;q=0.9',
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) throw new Error(`Telegram канал недоступен (${res.status}). Проверь что канал публичный.`)

  const html = await res.text()

  // Extract text from .tgme_widget_message_text divs
  // These contain the post text with possible nested tags
  const posts: string[] = []
  const blockRe = /<div[^>]+class="[^"]*tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
  let match: RegExpExecArray | null

  while ((match = blockRe.exec(html)) !== null && posts.length < 25) {
    // Strip HTML tags, decode entities
    const raw = match[1]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .trim()

    if (raw.length > 30) posts.push(raw)
  }

  return posts
}

// ── Instagram public profile scraper ────────────────────────────────────────
// Tries Instagram's internal API endpoint (works for public profiles)
async function scrapeInstagram(username: string): Promise<{ bio: string; posts: string[] }> {
  // Method 1: Instagram internal profile endpoint (public, no auth)
  const apiUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`
  try {
    const res = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Mobile/15E148 Safari/604.1',
        'Accept': '*/*',
        'Accept-Language': 'ru,en;q=0.9',
        'x-ig-app-id': '936619743392459',
        'Referer': `https://www.instagram.com/${username}/`,
      },
      signal: AbortSignal.timeout(15000),
    })

    if (res.ok) {
      const json = await res.json() as {
        data?: {
          user?: {
            biography?: string
            edge_owner_to_timeline_media?: {
              edges?: Array<{ node?: { edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> }; accessibility_caption?: string } }>
            }
          }
        }
      }
      const user = json?.data?.user
      if (user) {
        const bio = user.biography ?? ''
        const posts: string[] = []
        const edges = user.edge_owner_to_timeline_media?.edges ?? []
        for (const edge of edges) {
          const caption = edge.node?.edge_media_to_caption?.edges?.[0]?.node?.text
          if (caption && caption.length > 20) posts.push(caption)
          if (posts.length >= 20) break
        }
        return { bio, posts }
      }
    }
  } catch { /* fall through to method 2 */ }

  // Method 2: Scrape HTML page and look for embedded JSON
  const pageRes = await fetch(`https://www.instagram.com/${username}/`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Accept-Language': 'ru,en;q=0.9',
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!pageRes.ok) {
    throw new Error(
      'Instagram не отвечает. Попробуй:\n• Убедись что аккаунт публичный\n• Вставь тексты постов вручную через «Загрузить материалы»'
    )
  }

  const html = await pageRes.text()

  // Try to parse _sharedData or early page data
  let bio = ''
  const bioMatch = html.match(/"biography"\s*:\s*"([^"]*)"/)
  if (bioMatch) bio = bioMatch[1].replace(/\\n/g, '\n').replace(/\\u[\dA-Fa-f]{4}/g, '')

  // Look for caption texts
  const posts: string[] = []
  const captionRe = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g
  let cm: RegExpExecArray | null
  while ((cm = captionRe.exec(html)) !== null && posts.length < 15) {
    const text = cm[1]
      .replace(/\\n/g, '\n')
      .replace(/\\u[\dA-Fa-f]{4}/g, char => String.fromCharCode(parseInt(char.slice(2), 16)))
      .replace(/\\"/g, '"')
      .trim()
    if (text.length > 40 && !text.includes('{"') && !text.startsWith('http')) {
      posts.push(text)
    }
  }

  if (!bio && posts.length === 0) {
    throw new Error(
      'Instagram заблокировал автоматическую загрузку. Пожалуйста, скопируй тексты своих постов и загрузи их через раздел «Материалы» вручную.'
    )
  }

  return { bio, posts }
}

// ── Main handler ─────────────────────────────────────────────────────────────
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

    // Verify project ownership
    const { data: project } = await supabase
      .from('projects').select('id, name').eq('id', projectId).eq('owner_id', user.id).single()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    let contentText = ''
    let postsCount = 0

    if (platform === 'telegram') {
      const posts = await scrapeTelegram(username)
      if (posts.length === 0) {
        return NextResponse.json({ error: 'Постов не найдено. Убедись что канал публичный (не приватный).' }, { status: 422 })
      }
      postsCount = posts.length
      contentText = `Telegram-канал @${username}\n\nПоследние ${postsCount} постов:\n\n` +
        posts.map((p, i) => `--- Пост ${i + 1} ---\n${p}`).join('\n\n')
    } else {
      const { bio, posts } = await scrapeInstagram(username)
      postsCount = posts.length + (bio ? 1 : 0)
      contentText = `Instagram @${username}\n\n`
      if (bio) contentText += `Описание профиля:\n${bio}\n\n`
      if (posts.length > 0) {
        contentText += `Последние ${posts.length} постов:\n\n` +
          posts.map((p, i) => `--- Пост ${i + 1} ---\n${p}`).join('\n\n')
      }
    }

    // Delete old scrape for this platform to avoid duplicates
    const materialTitle = platform === 'telegram'
      ? `Telegram @${username}`
      : `Instagram @${username}`

    await supabase
      .from('project_materials')
      .delete()
      .eq('project_id', projectId)
      .eq('material_type', 'other')
      .ilike('title', `%${platform === 'telegram' ? 'Telegram' : 'Instagram'}%`)

    // Save as project material
    const { error: insertError } = await supabase.from('project_materials').insert({
      project_id: projectId,
      material_type: 'other',
      title: materialTitle,
      raw_content: contentText,
      processing_status: 'ready',
    })

    if (insertError) throw insertError

    console.log(`[scrape-social] ${platform} @${username} → ${postsCount} items, project=${projectId}`)

    return NextResponse.json({
      success: true,
      postsCount,
      message: `Загружено ${postsCount} постов из ${platform === 'telegram' ? 'Telegram' : 'Instagram'} — AI теперь знает твой стиль`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка загрузки'
    console.error('[scrape-social] Error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
