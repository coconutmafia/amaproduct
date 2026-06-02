import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/client'
import { buildRAGContext, type RAGContext } from '@/lib/ai/rag'
import { buildSystemPrompt } from '@/lib/ai/prompts/system'
import type { Message } from '@/types'

// Vercel Pro allows up to 300s. Multi-item answers ("5 рилзов") on top of a
// large RAG system prompt routinely take well over 60s — the old 60s cap was
// killing the function mid-stream, so the answer arrived truncated (e.g. 2 of 5
// reels). 300s + the continuation loop below guarantees the full answer.
export const maxDuration = 300

const STREAM_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'no-cache',
  'X-Accel-Buffering': 'no',
} as const

// Stream a chat completion as plain text. If Claude hits the token ceiling
// mid-answer (stop_reason === 'max_tokens') — likely on "5 рилзов"-style
// requests — automatically continue from where it stopped (a trailing assistant
// turn makes Claude resume the same text) so nothing is ever cut off.
function streamingChatResponse(
  system: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
) {
  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      let acc = ''
      try {
        for (let round = 0; round < 4; round++) {
          const convo = round === 0 ? messages : [...messages, { role: 'assistant' as const, content: acc }]
          const stream = anthropic.messages.stream({ model: MODEL, max_tokens: 8000, system, messages: convo })
          for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
              acc += chunk.delta.text
              controller.enqueue(encoder.encode(chunk.delta.text))
            }
          }
          const final = await stream.finalMessage()
          if (final.stop_reason !== 'max_tokens') break
        }
        controller.close()
      } catch (err) {
        console.error('Chat stream error:', err)
        if (acc.length > 0) {
          // Don't present a truncated answer as complete — append a visible note,
          // then close so the partial text is kept.
          try { controller.enqueue(encoder.encode('\n\n⚠️ Ответ прервался — нажми отправить ещё раз, чтобы продолжить.')) } catch { /* ignore */ }
          try { controller.close() } catch { /* already closed */ }
        } else {
          try { controller.error(err) } catch { /* already errored */ }
        }
      }
    },
  })
  return new Response(readable, { headers: STREAM_HEADERS })
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { messages, projectId, genFormat }: {
      messages: Message[]
      projectId?: string
      conversationType?: string
      // Set when generating a content-plan unit — makes the AI return ONLY the
      // clean content (no «Окей, вот пост:» lead-in that would get saved with it).
      genFormat?: string
    } = await request.json()

    // ── Standalone mode (no projectId): a content assistant powered by the
    // methodology/knowledge base, for bloggers without a project yet —
    // testing hypotheses, picking a niche, drafting content. ───────────────
    if (!projectId) {
      const lastMessage = messages[messages.length - 1]?.content || ''
      let sysKnowledge = ''
      try {
        const rag = await buildRAGContext(lastMessage, '00000000-0000-0000-0000-000000000000')
        sysKnowledge = rag.systemKnowledge.map(c => c.chunk_text).join('\n\n').slice(0, 4000)
      } catch { /* no system knowledge */ }

      const standaloneSystem = `Ты — AI-ассистент по контенту и запускам для блогеров и экспертов, построенный на проверенной методологии прогревов и продаж в блоге.

ТВОЯ РОЛЬ:
- Помогаешь любому блогеру/эксперту: подобрать нишу, протестировать гипотезу контента, придумать и НАПИСАТЬ пост/рилз/сторис/сценарий, собрать прогрев, разобрать идею.
- Когда просят написать — даёшь СРАЗУ готовый, живой контент (не «вот советы»), по законам залетающего контента: сильный хук в первые секунды, конкретика, эмоция, чёткий призыв.
- Отвечаешь живым человеческим языком, без воды и канцелярита, без хэштегов.
- Если не хватает вводных (ниша, продукт, аудитория) — задай 1-2 уточняющих вопроса, потом делай.

ФОРМАТ ОТВЕТА (ВАЖНО):
- НЕ используй markdown-разметку. НИКАКИХ **звёздочек**, ## решёток, --- тире-разделителей, * для списков, \`кода\`.
- Пиши чистым текстом, как реальный пост/сообщение. Разделяй смысловые блоки пустой строкой (воздух).
- Если нужен список — нумеруй просто «1.», «2.» с новой строки, без звёздочек.
- Заголовки выделяй просто КАПСОМ или эмодзи, а не ## и **.
- Если просят НЕСКОЛЬКО штук («5 рилзов», «10 идей») — выдай РОВНО столько, каждую полностью и пронумерованно. Не останавливайся на половине, не пиши «продолжить?» — доводи список до конца.

Ты сильнее обычного ChatGPT в контенте, потому что работаешь по конкретной методологии прогревов (ниже) и думаешь как продюсер запусков, а не как универсальный бот.

${sysKnowledge ? `═══ МЕТОДОЛОГИЯ (опирайся на неё) ═══\n${sysKnowledge}` : ''}`

      return streamingChatResponse(standaloneSystem, messages.map((m) => ({ role: m.role, content: m.content })))
    }

    const { data: project } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single()

    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const lastMessage = messages[messages.length - 1]?.content || ''
    let ragContext: RAGContext = { systemKnowledge: [], projectContext: [], styleExamples: [] }
    try {
      ragContext = await buildRAGContext(lastMessage, projectId)
    } catch {
      // RAG unavailable
    }

    const baseSystem = buildSystemPrompt(ragContext, project)

    // Wrap the content-generation system prompt with an ASSISTANT framing.
    // Personal content assistant for THIS blogger — grounded only in the
    // project's materials, speaking in their voice. Not a general chatbot.
    const systemPrompt = `Ты — личный AI-ассистент по контенту для этого блогера. Ты живёшь внутри его рабочего пространства и знаешь всё о его проекте из материалов ниже.

ТВОЯ РОЛЬ:
- Помогаешь с любым вопросом по контенту: придумать пост/рилз/сторис/карусель, доработать идею, накидать темы, переписать текст, собрать структуру, ответить по стратегии.
- Когда просят что-то написать — пишешь СРАЗУ готовый контент в голосе этого блогера, а не общие советы.
- Отвечаешь живо, по-человечески, без воды и канцелярита.

ЖЁСТКИЕ ПРАВИЛА:
1. Опирайся ТОЛЬКО на материалы проекта ниже (его голос, кейсы, аудитория, продукт, линии блога, анализ Instagram). НЕ выдумывай факты, цифры, кейсы и имена, которых нет в материалах.
2. Если данных не хватает — честно скажи чего не хватает и предложи что догрузить. Не придумывай.
3. Любой текст пиши голосом этого блогера (его словечки, ритм, воздух между абзацами), а не нейтральным «AI-языком». Без хэштегов.
4. Ты НЕ универсальный чат-бот «обо всём». Ты ассистент по контенту ЭТОГО проекта.
5. НЕ используй markdown: никаких **звёздочек**, ## решёток, --- разделителей, * списков, \`кода\`. Только чистый текст с пустыми строками между блоками, как реальный пост.
6. Если просят несколько штук («5 рилзов», «10 идей») — выдай РОВНО столько, сколько просят, каждую полностью и пронумерованно (1., 2., …). Не останавливайся на середине и не спрашивай «продолжать?» — доводи до конца.
${genFormat ? `
═══ РЕЖИМ ГЕНЕРАЦИИ ЕДИНИЦЫ КОНТЕНТА (${genFormat}) ═══
Этот текст пользователь сохранит и опубликует как есть. Поэтому:
- Выдавай СРАЗУ только сам готовый текст контента, ничего лишнего.
- НЕ начинай со вводных фраз («Окей», «Конечно», «Вот», «Держи», «Делаем», «Готово», «Отлично») и НЕ повторяй тему/задание перед текстом.
- НЕ добавляй комментарии после текста («Готово!», «Если нужно — поправлю», «Хочешь иначе?»).
- Первая строка ответа = первая строка контента. Последняя строка ответа = последняя строка контента.` : ''}

${baseSystem}`

    return streamingChatResponse(systemPrompt, messages.map((m) => ({ role: m.role, content: m.content })))
  } catch (error) {
    console.error('Chat error:', error)
    const msg = error instanceof Error ? error.message : String(error)
    // Surface the real error to help diagnose (API key, model, etc.)
    return NextResponse.json({ error: msg || 'Chat failed' }, { status: 500 })
  }
}
