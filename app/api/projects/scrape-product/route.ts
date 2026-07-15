import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { rateLimit } from '@/lib/rateLimit'
import { assertPublicUrl } from '@/lib/security/ssrf'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\\n/g, '\n').replace(/\\"/g, '"').trim()
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await rateLimit(user.id, 'scrape-product')
    if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })
    if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'AI не настроен (нет ANTHROPIC_API_KEY)' }, { status: 500 })

    const { url } = await request.json() as { url: string }
    if (!url?.trim()) return NextResponse.json({ error: 'URL не указан' }, { status: 400 })

    // SSRF guard: the page is fetched server-side and its text is returned to the
    // user, so an internal address would be readable. Reject private/metadata hosts.
    let safeUrl: URL
    try {
      safeUrl = await assertPublicUrl(url)
    } catch {
      return NextResponse.json({ error: 'Недопустимый адрес страницы' }, { status: 400 })
    }

    // Fetch the sales page
    let pageText = ''
    let pageTitle = ''
    try {
      const res = await fetch(safeUrl.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
          'Accept-Language': 'ru,en;q=0.9',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(12000),
      })
      if (!res.ok) throw new Error(`Сайт вернул ошибку ${res.status}`)
      const html = await res.text()

      // Extract title
      const titleM = html.match(/<title[^>]*>([^<]+)<\/title>/i)
        || html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)
      if (titleM) pageTitle = decodeHtml(titleM[1])

      // Extract og:description
      const descM = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i)
        || html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)
      if (descM) pageText += decodeHtml(descM[1]) + '\n\n'

      // Extract main text content (strip scripts/styles/nav)
      const cleaned = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')

      // Extract text from h1/h2/h3/p/li blocks. Track a running length instead of
      // re-joining every iteration (was O(n²)); collect up to ~8000 chars so the
      // 5000-char prompt slice below has clean, deduped content to work from.
      const blockRe = /<(h[1-3]|p|li)[^>]*>([\s\S]*?)<\/\1>/gi
      let m: RegExpExecArray | null
      const chunks: string[] = []
      const seen = new Set<string>()
      let collected = pageText.length
      while ((m = blockRe.exec(cleaned)) !== null && collected < 8000) {
        const t = decodeHtml(m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
        if (t.length > 20 && !seen.has(t)) {
          seen.add(t)
          chunks.push(t)
          collected += t.length + 1
        }
      }
      pageText += chunks.join('\n')
    } catch (e) {
      return NextResponse.json({
        error: `Не удалось загрузить страницу: ${e instanceof Error ? e.message : 'ошибка сети'}`,
      }, { status: 422 })
    }

    if (!pageText.trim()) {
      return NextResponse.json({ error: 'Страница не содержит текстового контента' }, { status: 422 })
    }

    // Analyze with Claude
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const aiResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `Ты анализируешь страницу продажи продукта/услуги.

Заголовок страницы: ${pageTitle || '(не найден)'}

Текст страницы:
${pageText.slice(0, 5000)}

На основе этих данных заполни JSON:
{
  "name": "Название продукта/услуги (как написано на странице, кратко)",
  "product_type": "один из: курс | консультация | марафон | интенсив | мастер-класс | наставничество | подписка | другое",
  "description": "Описание для продавца: что получит клиент, формат, длительность, ключевые результаты (3-5 предложений)"
}

Если данных недостаточно — пиши пустую строку "".
Верни ТОЛЬКО JSON.`,
      }],
    })

    const rawText = aiResponse.content[0].type === 'text' ? aiResponse.content[0].text : ''
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Не удалось проанализировать страницу' }, { status: 500 })
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      name?: string
      product_type?: string
      description?: string
    }

    // Normalize product_type to the wizard's whitelist so a synonym / English /
    // capitalized value from the model isn't silently dropped to the default.
    const VALID_TYPES = ['курс', 'консультация', 'марафон', 'интенсив', 'мастер-класс', 'наставничество', 'подписка', 'другое']
    const SYNONYMS: Record<string, string> = {
      course: 'курс', consultation: 'консультация', consult: 'консультация',
      marathon: 'марафон', intensive: 'интенсив', workshop: 'мастер-класс',
      masterclass: 'мастер-класс', 'мастер класс': 'мастер-класс',
      mentorship: 'наставничество', mentoring: 'наставничество',
      subscription: 'подписка', membership: 'подписка', other: 'другое',
    }
    const rawType = (parsed.product_type || '').trim().toLowerCase()
    const product_type = VALID_TYPES.includes(rawType) ? rawType
      : (SYNONYMS[rawType] ?? (rawType ? 'другое' : ''))

    return NextResponse.json({
      success: true,
      name: parsed.name || '',
      product_type,
      description: parsed.description || '',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка анализа'
    console.error('[scrape-product] Error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
