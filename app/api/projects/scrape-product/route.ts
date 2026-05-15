import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

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

    const { url } = await request.json() as { url: string }
    if (!url?.trim()) return NextResponse.json({ error: 'URL не указан' }, { status: 400 })

    // Fetch the sales page
    let pageText = ''
    let pageTitle = ''
    try {
      const res = await fetch(url.trim(), {
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

      // Extract text from h1/h2/h3/p/li blocks
      const blockRe = /<(h[1-3]|p|li)[^>]*>([\s\S]*?)<\/\1>/gi
      let m: RegExpExecArray | null
      const chunks: string[] = []
      while ((m = blockRe.exec(cleaned)) !== null && pageText.length + chunks.join(' ').length < 6000) {
        const t = decodeHtml(m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
        if (t.length > 20) chunks.push(t)
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

    return NextResponse.json({
      success: true,
      name: parsed.name || '',
      product_type: parsed.product_type || '',
      description: parsed.description || '',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка анализа'
    console.error('[scrape-product] Error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
