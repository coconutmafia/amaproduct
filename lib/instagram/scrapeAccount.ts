// Shared Apify-scrape + AI-analysis logic for an Instagram account (own or
// competitor), used by the background job runner (lib/jobs/runInstagramScrapeJob.ts).
// Extracted from app/api/instagram/scrape/route.ts when that route moved to the
// jobs pattern (roadmap #8 style — client no longer holds an SSE connection open).

// Apify actor — official, paid-per-call ($0.003-0.005 per profile + 25 posts)
export const APIFY_ACTOR = 'apify~instagram-profile-scraper'

export function parseUsername(input: string): string | null {
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
export function buildAccountText(profile: Record<string, unknown>): string {
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

export async function scrapeInstagram(username: string, token: string): Promise<Record<string, unknown>> {
  const url = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      usernames:    [username],
      resultsLimit: 25,
    }),
    // Cap the Apify run so a hung actor can't hang the request until maxDuration.
    signal: AbortSignal.timeout(80000),
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

export const ANALYSIS_SYSTEM = `Ты — стратег по контенту. На вход — данные Instagram-аккаунта (профиль + последние посты).
Сделай короткий, структурный разбор. Только русский, проза, без JSON.`

export function buildAnalysisPrompt(accountText: string, isOwn: boolean): string {
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
