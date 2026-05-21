import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/client'
import { NextResponse } from 'next/server'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

// Hard quotas (per project). Enforced server-side; the UI also hides the
// "Добавить" button at the limit, but never trust the client.
const QUOTA = { my_instagram: 1, competitors: 5 } as const
type IgType = keyof typeof QUOTA

// Apify actor — official, paid-per-call ($0.003-0.005 per profile + 25 posts)
const APIFY_ACTOR = 'apify~instagram-profile-scraper'

function parseUsername(input: string): string | null {
  const s = input.trim().replace(/^@+/, '')
  // Plain handle
  if (/^[A-Za-z0-9._]{1,30}$/.test(s)) return s
  // URL forms — strip protocol, host, query, trailing slash
  try {
    const url  = s.startsWith('http') ? new URL(s) : new URL('https://' + s)
    const path = url.pathname.replace(/^\/+|\/+$/g, '').split('/')[0]
    return /^[A-Za-z0-9._]{1,30}$/.test(path) ? path : null
  } catch { return null }
}

// Best-effort condense of the Apify response into readable text + tail of
// raw JSON for downstream inspection. Tolerant of multiple actor shapes.
function buildAccountText(profile: Record<string, unknown>): string {
  const get = <T>(k: string): T | undefined => profile[k] as T | undefined
  const username    = get<string>('username') ?? get<string>('handle') ?? '—'
  const fullName    = get<string>('fullName') ?? get<string>('name') ?? ''
  const biography   = get<string>('biography') ?? get<string>('bio') ?? ''
  const followers   = get<number>('followersCount') ?? get<number>('followers') ?? 0
  const following   = get<number>('followsCount') ?? get<number>('following') ?? 0
  const postsCount  = get<number>('postsCount') ?? get<number>('posts') ?? 0
  const posts       = (get<Array<Record<string, unknown>>>('latestPosts')
                    ?? get<Array<Record<string, unknown>>>('posts')
                    ?? []) as Array<Record<string, unknown>>

  const lines: string[] = []
  lines.push(`Аккаунт: @${username}${fullName ? ` (${fullName})` : ''}`)
  lines.push(`Подписчики: ${followers.toLocaleString('ru-RU')} · Подписки: ${following.toLocaleString('ru-RU')} · Постов всего: ${postsCount.toLocaleString('ru-RU')}`)
  if (biography) lines.push(`\nBio:\n${biography}`)
  lines.push(`\n— Посты (последние ${posts.length}) —\n`)

  for (const p of posts) {
    const caption = (p.caption as string) ?? (p.text as string) ?? ''
    const likes   = (p.likesCount as number) ?? (p.likes as number) ?? 0
    const cmts    = (p.commentsCount as number) ?? (p.comments as number) ?? 0
    const ts      = (p.timestamp as string) ?? (p.takenAt as string) ?? ''
    const type    = (p.type as string) ?? (p.productType as string) ?? ''
    const date    = ts ? new Date(ts).toLocaleDateString('ru-RU') : ''
    lines.push(`[${date}${type ? ` · ${type}` : ''}] ❤ ${likes} · 💬 ${cmts}`)
    if (caption) lines.push(caption.slice(0, 1500))
    lines.push('')
  }

  return lines.join('\n').trim()
}

async function scrapeInstagram(username: string, token: string) {
  const url = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      usernames:    [username],
      resultsLimit: 25,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Apify ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = await res.json() as unknown
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Apify вернул пустой результат — возможно профиль приватный или такого пользователя нет.')
  }
  return data[0] as Record<string, unknown>
}

const ANALYSIS_SYSTEM = `Ты — стратег по контенту. На вход — данные Instagram-аккаунта (профиль + последние посты).
Сделай короткий, структурный разбор. Только русский, проза, без JSON.`

function buildAnalysisPrompt(accountText: string, isOwn: boolean): string {
  return `${isOwn
    ? 'Это МОЙ аккаунт. Сделай разбор моего голоса/позиционирования глазами стороннего стратега.'
    : 'Это аккаунт КОНКУРЕНТА. Сделай разбор: что они делают, как себя позиционируют, что у них «заходит».'}

ДАННЫЕ:
${accountText.slice(0, 14000)}

СТРУКТУРА ОТВЕТА (кратко, по делу):

## Позиционирование
Кто этот человек/бренд, на кого работает, какое обещание даёт.

## Темы и контент
Какие 3-5 тем повторяются в постах. Какие форматы преобладают.

## Голос и стиль
Как пишет: формально/разговорно, эмоционально/сдержанно, какие фирменные обороты.

## Что «заходит»
Какие посты получили заметно больше лайков/комментов и почему — что в них общее (тема, заход, формат).

## Hooks / зацепки
3-5 конкретных зацепок (первых строк, поворотов смысла) из их постов, которые работают.

${isOwn ? '## Что можно усилить\nЧего не хватает или что слабо.' : '## Чему можно научиться\nЧто из их подхода можно адаптировать под себя (не копировать, а взять принцип).'}`
}

export async function POST(request: Request) {
  const apifyToken = process.env.APIFY_TOKEN
  if (!apifyToken) {
    return NextResponse.json({ error: 'APIFY_TOKEN не настроен в окружении. Добавь в Vercel env vars.' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { projectId?: string; instagramUrl?: string; accountType?: IgType }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const { projectId, instagramUrl, accountType } = body
  if (!projectId || !instagramUrl || !accountType) {
    return NextResponse.json({ error: 'projectId, instagramUrl, accountType обязательны' }, { status: 400 })
  }
  if (accountType !== 'my_instagram' && accountType !== 'competitors') {
    return NextResponse.json({ error: 'accountType должен быть my_instagram или competitors' }, { status: 400 })
  }

  const username = parseUsername(instagramUrl)
  if (!username) {
    return NextResponse.json({ error: 'Не удалось распознать имя пользователя. Используй формат instagram.com/handle или просто @handle.' }, { status: 400 })
  }

  // Verify project ownership
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('owner_id', user.id)
    .single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Enforce quota — count existing accounts of this type for the project
  const { count } = await supabase
    .from('project_materials')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('material_type', accountType)
  const used  = count ?? 0
  const limit = QUOTA[accountType]
  if (used >= limit) {
    return NextResponse.json({ error: `Лимит исчерпан: для ${accountType === 'my_instagram' ? 'своего аккаунта' : 'конкурентов'} максимум ${limit}. Удали один из существующих, чтобы добавить новый.` }, { status: 400 })
  }

  // Prevent duplicate of the same username for the same project
  const { data: duplicate } = await supabase
    .from('project_materials')
    .select('id')
    .eq('project_id', projectId)
    .eq('material_type', accountType)
    .eq('title', `@${username}`)
    .maybeSingle()
  if (duplicate) {
    return NextResponse.json({ error: `@${username} уже добавлен в этот проект.` }, { status: 400 })
  }

  // ── Run SSE-streamed: scrape → analyze → save ───────────────────────────
  const encoder = new TextEncoder()
  const stream  = new ReadableStream({
    async start(controller) {
      let closed = false
      const push = (s: string) => { if (!closed) { try { controller.enqueue(encoder.encode(s)) } catch { closed = true } } }
      const send = (d: Record<string, unknown>) => push(`data: ${JSON.stringify(d)}\n\n`)
      push(': open\n\n')
      const ping = setInterval(() => push(': ping\n\n'), 10000)

      try {
        send({ type: 'status', message: `Скачиваю данные @${username} из Instagram...` })
        const profile = await scrapeInstagram(username, apifyToken)

        send({ type: 'status', message: 'Готовлю текст и анализ...' })
        const accountText = buildAccountText(profile)

        // AI analysis (small, fast — ~30s)
        let analysis = ''
        try {
          const aiStream = anthropic.messages.stream({
            model:      MODEL,
            max_tokens: 3000,
            system:     ANALYSIS_SYSTEM,
            messages:   [{ role: 'user', content: buildAnalysisPrompt(accountText, accountType === 'my_instagram') }],
          })
          for await (const chunk of aiStream) {
            if (chunk.type === 'content_block_delta') send({ type: 'progress' })
          }
          const final = await aiStream.finalMessage()
          analysis = final.content.map(b => (b.type === 'text' ? b.text : '')).join('\n').trim()
        } catch (err) {
          // Don't fail the whole save if analysis fails — keep raw data
          console.error('[instagram/scrape] analysis failed:', err)
        }

        const fullText = analysis
          ? `${analysis}\n\n──────────\nСЫРЫЕ ДАННЫЕ (${new Date().toLocaleString('ru-RU')})\n\n${accountText}`
          : `${accountText}\n\n(AI-анализ не удалось сгенерировать — попробуй позже на этом материале вручную)`

        const { error: insertErr } = await supabase.from('project_materials').insert({
          project_id:        projectId,
          title:             `@${username}`,
          material_type:     accountType,
          raw_content:       fullText,
          processing_status: 'ready',
        })
        if (insertErr) throw new Error(`Не удалось сохранить: ${insertErr.message}`)

        send({ type: 'done', username })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Ошибка скрейпинга'
        console.error('[instagram/scrape] error:', msg)
        send({ type: 'error', message: msg })
      } finally {
        clearInterval(ping)
        closed = true
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':           'text/event-stream',
      'Cache-Control':          'no-cache, no-transform',
      'X-Accel-Buffering':      'no',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
