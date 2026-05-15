import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

async function scrapeInstagram(username: string): Promise<{ bio: string; posts: string[] }> {
  const posts: string[] = []
  let bio = ''

  try {
    const res = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': '*/*', 'Accept-Language': 'ru,en;q=0.9',
        'x-ig-app-id': '936619743392459',
        'Referer': `https://www.instagram.com/${username}/`,
      },
      signal: AbortSignal.timeout(12000),
    })
    if (res.ok) {
      const json = await res.json() as { data?: { user?: { biography?: string; edge_owner_to_timeline_media?: { edges?: Array<{ node?: { edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> } } }> } } } }
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

  // Fallback: HTML scrape
  try {
    const html = await fetch(`https://www.instagram.com/${username}/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'Accept-Language': 'ru,en;q=0.9' },
      signal: AbortSignal.timeout(12000),
    }).then(r => r.text())
    const bm = html.match(/"biography"\s*:\s*"([^"]*)"/)
    if (bm) bio = decodeHtml(bm[1])
    const re = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g
    let cm: RegExpExecArray | null
    while ((cm = re.exec(html)) !== null && posts.length < 20) {
      const t = decodeHtml(cm[1])
      if (t.length > 40 && !t.includes('{"') && !t.startsWith('http')) posts.push(t)
    }
  } catch { /* ignore */ }

  return { bio, posts: posts.slice(0, 20) }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { url } = await request.json() as { url: string }
    if (!url?.trim()) return NextResponse.json({ error: 'URL не указан' }, { status: 400 })

    const { username, platform } = extractUsername(url)

    // Scrape content
    let bio = ''
    let posts: string[] = []
    let platformLabel = ''

    if (platform === 'telegram') {
      const result = await scrapeTelegram(username)
      bio = result.bio
      posts = result.posts
      platformLabel = `Telegram @${username}`
    } else if (platform === 'instagram') {
      const result = await scrapeInstagram(username)
      bio = result.bio
      posts = result.posts
      platformLabel = `Instagram @${username}`
    } else {
      return NextResponse.json({ error: 'Поддерживаются только Instagram и Telegram для автозаполнения' }, { status: 400 })
    }

    if (!bio && posts.length === 0) {
      return NextResponse.json({ error: 'Не удалось загрузить данные профиля. Убедись что аккаунт публичный.' }, { status: 422 })
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
