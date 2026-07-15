import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rateLimit'
import { anthropic, MODEL_SONNET } from '@/lib/ai/client'

// Picks ONE short, scroll-stopping hook from a post so it can sit on the post
// IMAGE, while the full text goes in the caption. Short + cheap → Sonnet is fine.
export const maxDuration = 30

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await rateLimit(user.id, 'post-hook')
    if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

    const { text, styleNotes } = (await request.json()) as { text?: string; styleNotes?: string }
    if (!text || !text.trim()) return NextResponse.json({ error: 'Нет текста' }, { status: 400 })

    // Free-text brand wishes (set on the brand page) — let the creator steer the
    // hook by hand: which words to emphasise, or to skip emphasis entirely, etc.
    const notes = (styleNotes || '').trim().slice(0, 600)
    const prompt = `Вот текст от блогера. Нужен ОДИН короткий цепляющий крючок для картинки поста — фраза, которая остановит скролл и заставит захотеть прочитать пост целиком.
Правила:
- Если текст — это ЗАДАНИЕ с готовым заголовком («сделай картинку с заголовком…», «заголовок: …», «напиши на картинке…») — верни РОВНО этот заголовок (без слов задания).
- Иначе крючок — это ДОСЛОВНАЯ фраза (или усечённая часть фразы) ИЗ САМОГО текста. НЕ сочиняй новую формулировку и не перефразируй — текст утверждён автором.
- Очень коротко: 3-7 слов, максимум ~45 символов. Это НЕ весь пост, а хук на обложку.
- Выбирай самое яркое/интригующее (боль, обещание, неожиданность, цифру).
- Без кавычек, без хэштегов, без эмодзи, без точки в конце.
- Выдели 1 ключевое слово двойными звёздочками **слово** — оно станет акцентом на картинке.${notes ? `\n- ПОЖЕЛАНИЯ АВТОРА по оформлению (учти их, особенно про выделение слов — например «выдели 2 слова», «не выделяй ничего»): ${notes}` : ''}

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
