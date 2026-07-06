import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL, buildCachedSystem } from '@/lib/ai/client'
import { buildRAGContext, type RAGContext } from '@/lib/ai/rag'
import { buildSystemPrompt } from '@/lib/ai/prompts/system'
import { AI_TELLS_TO_AVOID } from '@/lib/ai/prompts/content-brain'
import { gateContentUnit, refundGeneration } from '@/lib/generations'
import type { Message } from '@/types'
import { rateLimit } from '@/lib/rateLimit'
import { requireProjectAccess } from '@/lib/projects/access'

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
  onEmptyError?: () => void | Promise<void>,
) {
  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      let acc = ''
      try {
        for (let round = 0; round < 4; round++) {
          const convo = round === 0 ? messages : [...messages, { role: 'assistant' as const, content: acc }]
          const stream = anthropic.messages.stream({ model: MODEL, max_tokens: 8000, system: buildCachedSystem(system), messages: convo })
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
          // Nothing was produced — refund the consumed content unit (if metered).
          if (onEmptyError) { try { await onEmptyError() } catch { /* ignore */ } }
          try { controller.error(err) } catch { /* already errored */ }
        }
      }
    },
  })
  return new Response(readable, { headers: STREAM_HEADERS })
}

const SAVED_TYPE_RU: Record<string, string> = { post: 'пост', carousel: 'карусель', reels: 'рилз', stories: 'сторис', email: 'письмо', live: 'эфир' }

// Pull the user's saved "Готовое" library into context so the assistant can
// reference and edit it directly instead of asking the user to paste the text
// (a real pain point: "you saved it, why do you ask me for it?").
async function buildSavedBlock(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  projectId?: string,
): Promise<string> {
  try {
    const { data } = await supabase
      .from('saved_content')
      .select('content_type, title, body, created_at, project_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(40)
    let rows = data ?? []
    if (rows.length === 0) return ''
    // This project's saves first, then the rest (global / other projects).
    if (projectId) rows = [...rows.filter((r) => r.project_id === projectId), ...rows.filter((r) => r.project_id !== projectId)]

    let budget = 9000 // char budget so we never blow up the prompt
    const parts: string[] = []
    let n = 0
    for (const r of rows) {
      const body = String(r.body ?? '').trim()
      if (!body) continue
      const type = SAVED_TYPE_RU[String(r.content_type ?? '')] || 'контент'
      const title = (String(r.title ?? '') || body.split('\n')[0] || '').slice(0, 80)
      const entry = `[${n + 1}] ${type} — «${title}»\n${body}`
      if (parts.length > 0 && entry.length > budget) break
      parts.push(entry.length > 4000 ? entry.slice(0, 4000) + '…' : entry)
      budget -= entry.length
      n++
      if (budget <= 0) break
    }
    if (parts.length === 0) return ''
    return `

═══ СОХРАНЁННЫЙ КОНТЕНТ ПОЛЬЗОВАТЕЛЯ («Готовое») ═══
Ниже — контент, который пользователь УЖЕ сохранил в библиотеку «Готовое». Если он ссылается на ранее сохранённый/готовый рилз, пост, карусель, сторис и т.п. — НАЙДИ его в этом списке и работай с его текстом напрямую (покажи, поправь, перепиши, используй как основу). НЕ проси пользователя прислать текст, который уже есть здесь. Если нужного действительно нет — скажи, что не нашёл в «Готовом», и попроси уточнить.

${parts.join('\n\n———\n\n')}`
  } catch {
    return ''
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await rateLimit(user.id, 'chat')
    if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

    const { messages, projectId, genFormat }: {
      messages: Message[]
      projectId?: string
      conversationType?: string
      // Set when generating a content-plan unit — makes the AI return ONLY the
      // clean content (no «Окей, вот пост:» lead-in that would get saved with it).
      genFormat?: string
    } = await request.json()

    // A finished content unit (genFormat set = «Сгенерировать пост/рилз/…») costs
    // one unit; free-form chat / refinement does not. Meter at the moment of
    // generation. Returns a 402 only when enforcement is live AND the quota is
    // spent (off pre-launch — see BILLING_ENFORCED). Refund handled per-branch if
    // the stream produces nothing.
    const meterGeneration = async (): Promise<Response | null> => {
      if (!genFormat) return null
      const gate = await gateContentUnit(user.id)
      if (gate.blocked) {
        return NextResponse.json(
          { error: 'limit_reached', code: 'limit_reached', monthlyUsed: gate.monthlyUsed, monthlyLimit: gate.monthlyLimit },
          { status: 402 },
        )
      }
      return null
    }
    const refundIfMetered = genFormat ? () => refundGeneration(user.id) : undefined

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

      const savedBlock = await buildSavedBlock(supabase, user.id)

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

${AI_TELLS_TO_AVOID}

${sysKnowledge ? `═══ МЕТОДОЛОГИЯ (опирайся на неё) ═══\n${sysKnowledge}` : ''}${savedBlock}`

      const blocked = await meterGeneration()
      if (blocked) return blocked
      return streamingChatResponse(standaloneSystem, messages.map((m) => ({ role: m.role, content: m.content })), refundIfMetered)
    }

    // AI generation costs real money and no RLS-gated table write happens in
    // this route to naturally block a viewer — check editor+ explicitly.
    const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    const { data: project } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
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
    const savedBlock = await buildSavedBlock(supabase, user.id, projectId)

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
- 🚫 НИКАКОГО JSON, фигурных скобок {}, ключей "key": или служебной разметки — только готовый человеческий текст. Для карусели/рилз/сторис разбивай на блоки ОБЫЧНЫМ текстом, каждый с новой строки («Слайд 1:», затем заголовок и текст; «Сцена 1 (0-3 сек):», затем что на экране и озвучка).
- НЕ начинай со вводных фраз («Окей», «Конечно», «Вот», «Держи», «Делаем», «Готово», «Отлично») и НЕ повторяй тему/задание перед текстом.
- НЕ добавляй комментарии после текста («Готово!», «Если нужно — поправлю», «Хочешь иначе?»).
- Первая строка ответа = первая строка контента. Последняя строка ответа = последняя строка контента.` : ''}

${baseSystem}${savedBlock}`

    const blocked = await meterGeneration()
    if (blocked) return blocked
    return streamingChatResponse(systemPrompt, messages.map((m) => ({ role: m.role, content: m.content })), refundIfMetered)
  } catch (error) {
    console.error('Chat error:', error)
    const msg = error instanceof Error ? error.message : String(error)
    // Surface the real error to help diagnose (API key, model, etc.)
    return NextResponse.json({ error: msg || 'Chat failed' }, { status: 500 })
  }
}
