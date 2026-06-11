import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL_SONNET } from '@/lib/ai/client'

// Picks ONE short, scroll-stopping hook from a post so it can sit on the post
// IMAGE, while the full text goes in the caption. Short + cheap → Sonnet is fine.
export const maxDuration = 30

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { text } = (await request.json()) as { text?: string }
    if (!text || !text.trim()) return NextResponse.json({ error: 'Нет текста' }, { status: 400 })

    const prompt = `Вот текст поста. Выбери ОДИН короткий цепляющий крючок для картинки поста — фразу, которая остановит скролл и заставит захотеть прочитать пост целиком.
Правила:
- Крючок — это ДОСЛОВНАЯ фраза (или усечённая часть фразы) ИЗ САМОГО текста. НЕ сочиняй новую формулировку и не перефразируй — текст утверждён автором.
- Очень коротко: 3-7 слов, максимум ~45 символов. Это НЕ весь пост, а хук на обложку.
- Выбирай самое яркое/интригующее (боль, обещание, неожиданность, цифру).
- Без кавычек, без хэштегов, без эмодзи, без точки в конце.
- Выдели 1 ключевое слово двойными звёздочками **слово** — оно станет акцентом на картинке.

ТЕКСТ ПОСТА:
${text.slice(0, 4000)}

Верни ТОЛЬКО сам крючок, одной строкой.`

    const res = await anthropic.messages.create({
      model: MODEL_SONNET,
      max_tokens: 60,
      messages: [{ role: 'user', content: prompt }],
    })
    const block = res.content.find((b) => b.type === 'text')
    const raw = block && block.type === 'text' ? block.text : ''
    const hook = raw.trim().split('\n').map((l) => l.trim()).find(Boolean)?.replace(/^["'«»]+|["'«».]+$/g, '').slice(0, 70) ?? ''
    if (!hook) return NextResponse.json({ error: 'Не удалось подобрать крючок' }, { status: 502 })
    return NextResponse.json({ hook })
  } catch (e) {
    console.error('[post-hook]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}
