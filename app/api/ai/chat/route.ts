import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { anthropic, MODEL, buildCachedSystem } from '@/lib/ai/client'
import { buildRAGContext, type RAGContext } from '@/lib/ai/rag'
import { buildSystemPrompt } from '@/lib/ai/prompts/system'
import { AI_TELLS_TO_AVOID, resolveContentLanguage } from '@/lib/ai/prompts/content-brain'
import { gateContentUnits, refundGenerations } from '@/lib/generations'
import { UNIT_COSTS } from '@/lib/generations-config'
import { gateMicroAction } from '@/lib/ai/usage'
import { requirePaidAccess } from '@/lib/billing/access'
import type { Message } from '@/types'
import { rateLimit } from '@/lib/rateLimit'
import { requireProjectAccess } from '@/lib/projects/access'
import { captureException } from '@/lib/sentry'

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

// ── Почтовый ящик genFormat-ответа (24.08) ───────────────────────────────────
// Замерено пробником chat-unit-fate: при смерти вкладки серверная инвокация
// ПЕРЕЖИВАЕТ обрыв и достримливает ответ В ПУСТОТУ (enqueue в отменённый стрим
// на Vercel не кидает) — юнит списан, готовый ответ выброшен, сервер обрыва
// не видит (рефанд-по-обрыву невозможен). Фикс класса «долгий запрос умирает
// на мобиле»: для метеренной генерации (genFormat) заводим строку в jobs ДО
// стрима, отдаём её id заголовком X-Gen-Job (заголовки доезжают до первого
// байта), а ГОТОВЫЙ текст дописываем в jobs.result по завершении — клиент,
// потерявший вкладку, забирает ПОЛНЫЙ ответ по этому id вместо огрызка.
async function createGenMailbox(userId: string): Promise<string | null> {
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('jobs').insert({
      user_id: userId,
      type:    'chat_gen',
      status:  'processing',
      payload: {},
    }).select('id').single()
    return (data?.id as string) ?? null
  } catch {
    return null // ящик — страховка, не условие ответа
  }
}

// Stream a chat completion as plain text. If Claude hits the token ceiling
// mid-answer (stop_reason === 'max_tokens') — likely on "5 рилзов"-style
// requests — automatically continue from where it stopped (a trailing assistant
// turn makes Claude resume the same text) so nothing is ever cut off.
type ChatMsg = { role: 'user' | 'assistant'; content: string; images?: string[] }

// Картинки → блоки контента для модели. Принимаем только data:image/...;base64
// от нашего же композера (он ужимает фото до 1568px и jpeg) — чужой URL сюда
// не пролезет, значит нельзя заставить сервер ходить по произвольным адресам.
type ImageMedia = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
function imageBlocks(images?: string[]) {
  const out: Array<{ type: 'image'; source: { type: 'base64'; media_type: ImageMedia; data: string } }> = []
  for (const src of (images ?? []).slice(0, 3)) {
    const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(src ?? '')
    if (!m) continue
    if (m[2].length > 7_000_000) continue // ~5 МБ после декодирования — потолок модели
    out.push({ type: 'image', source: { type: 'base64', media_type: m[1] as ImageMedia, data: m[2] } })
  }
  return out
}

function streamingChatResponse(
  system: string,
  messages: ChatMsg[],
  onEmptyError?: () => void | Promise<void>,
  genJobId?: string | null,
) {
  const encoder = new TextEncoder()
  // Кэш-брейкпоинт на последнем сообщении: следующий ход диалога и раунды
  // авто-продолжения читают систему+историю из кэша за ~10% цены вместо полной
  // (брейкпоинт на system покрывает только его, история шла по полной).
  // На выход не влияет — модель видит те же токены байт-в-байт.
  // TTL '1h', как у системного блока (см. buildCachedSystem): пауза человека
  // между сообщениями обычно длиннее 5 минут, и протухший брейкпоинт заставлял
  // переписывать систему+историю целиком по 1.25× — 84% цены чата были записи.
  const cachedMessages = messages.map((m, i) => {
    const imgs = i === messages.length - 1 ? imageBlocks(m.images) : []
    if (i !== messages.length - 1) return { role: m.role, content: m.content }
    return {
      role: m.role,
      content: [
        ...imgs,
        { type: 'text' as const, text: m.content, cache_control: { type: 'ephemeral' as const, ttl: '1h' as const } },
      ],
    }
  })
  const mailbox = async (patch: Record<string, unknown>) => {
    if (!genJobId) return
    try { await createAdminClient().from('jobs').update(patch).eq('id', genJobId) } catch { /* страховка */ }
  }
  const readable = new ReadableStream({
    async start(controller) {
      let acc = ''
      try {
        for (let round = 0; round < 4; round++) {
          // Продолжение через ЗАВЕРШАЮЩИЙ user-ход, а не хвостовой assistant:
          // замерено 25.08 — модели 4.8/5 отвечают 400 «does not support
          // assistant message prefill» на диалог, кончающийся assistant'ом
          // (то есть раунды 2+ были МОЛЧА сломаны: длинный ответ обрезался с
          // пометкой «прервался»). Шов проверен живьём: обе модели продолжают
          // с той же буквы без повторов. Потолок 16000 (было 8000): у opus-5
          // размышление тратит часть бюджета, «5 рилзов» должны влезать в
          // один раунд.
          const convo = round === 0 ? cachedMessages : [
            ...cachedMessages,
            { role: 'assistant' as const, content: acc },
            { role: 'user' as const, content: 'Продолжи свой ответ ТОЧНО с места обрыва: начни с той самой буквы, на которой оборвался текст, без повторов уже написанного, без вступлений и пояснений.' },
          ]
          const stream = anthropic.messages.stream({ model: MODEL, max_tokens: 16000, system: buildCachedSystem(system), messages: convo })
          for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
              acc += chunk.delta.text
              controller.enqueue(encoder.encode(chunk.delta.text))
            }
          }
          const final = await stream.finalMessage()
          if (final.stop_reason !== 'max_tokens') break
        }
        // Полный ответ — в ящик (инвокация жива даже при умершей вкладке).
        await mailbox({ status: 'done', result: { text: acc, complete: true } })
        controller.close()
      } catch (err) {
        console.error('Chat stream error:', err)
        // Слепое окно урока 31 июля: обрыв стрима (перегруз/кредиты Anthropic)
        // раньше жил только в console.error — в /admin/errors его не было, и
        // окно сбоев диагностировалось задним числом по косвенным уликам.
        await captureException(err, { where: 'chat stream', gotChars: acc.length })
        if (acc.length > 0) {
          // Don't present a truncated answer as complete — append a visible note,
          // then close so the partial text is kept.
          await mailbox({ status: 'done', result: { text: acc, complete: false } })
          try { controller.enqueue(encoder.encode('\n\n⚠️ Ответ прервался — нажми отправить ещё раз, чтобы продолжить.')) } catch { /* ignore */ }
          try { controller.close() } catch { /* already closed */ }
        } else {
          // Nothing was produced — refund the consumed content unit (if metered).
          if (onEmptyError) { try { await onEmptyError() } catch { /* ignore */ } }
          await mailbox({ status: 'error', error: 'Ассистент сейчас перегружен — попробуй через минуту-две. Единица контента возвращена.' })
          try { controller.error(err) } catch { /* already errored */ }
        }
      }
    },
  })
  return new Response(readable, {
    headers: genJobId ? { ...STREAM_HEADERS, 'X-Gen-Job': genJobId } : STREAM_HEADERS,
  })
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

    // Access check must cover the WHOLE chat, not just the «Сгенерировать» button:
    // the assistant writes finished posts on a plain «напиши пост про X» too, so
    // gating only the metered branch let an un-entitled user take content for free.
    const denied = await requirePaidAccess(user.id)
    if (denied) return denied

    const { messages, projectId, genFormat, images }: {
      messages: Message[]
      projectId?: string
      conversationType?: string
      // Set when generating a content-plan unit — makes the AI return ONLY the
      // clean content (no «Окей, вот пост:» lead-in that would get saved with it).
      genFormat?: string
      // Фото к последнему сообщению (просьба клиента 26.08). Только data-URL от
      // нашего композера; видео модель не принимает — для него в продукте есть
      // «Тренды» (залетевшие рилзы) и «Монтаж».
      images?: string[]
    } = await request.json()

    // A finished content unit (genFormat set = «Сгенерировать пост/рилз/…») costs
    // one unit; free-form chat / refinement does not. Meter at the moment of
    // generation. Returns a 402 only when enforcement is live AND the quota is
    // spent (off pre-launch — see BILLING_ENFORCED). Refund handled per-branch if
    // the stream produces nothing.
    const meterGeneration = async (): Promise<Response | null> => {
      if (!genFormat) {
        // Свободный чат: UNIT_COSTS.chat_batch сообщений = 1 единица (решение
        // Матвея 25.08 после замера: ход с контекстом проекта стоит $0.03-0.24).
        // Блокирует только полностью исчерпанный месячный лимит — клиент увидит
        // тот же диалог «Лимит исчерпан», что и на генерации.
        const micro = await gateMicroAction(user.id, 'chat', UNIT_COSTS.chat_batch)
        if (micro.blocked) {
          return NextResponse.json({ error: 'limit_reached', code: 'limit_reached' }, { status: 402 })
        }
        return null
      }
      const gate = await gateContentUnits(user.id, UNIT_COSTS.content)
      if (gate.blocked) {
        // Report WHY: an unpaid user must not be told «лимит исчерпан» (he has
        // used 0) — he needs «подключи тариф».
        const code = gate.reason === 'not_entitled' ? 'payment_required' : 'limit_reached'
        return NextResponse.json(
          { error: code, code, monthlyUsed: gate.monthlyUsed, monthlyLimit: gate.monthlyLimit },
          { status: 402 },
        )
      }
      return null
    }
    const refundIfMetered = genFormat ? () => refundGenerations(user.id, UNIT_COSTS.content) : undefined

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
      const genJobId = genFormat ? await createGenMailbox(user.id) : null
      return streamingChatResponse(
        standaloneSystem,
        messages.map((m, i) => ({ role: m.role, content: m.content, ...(i === messages.length - 1 ? { images } : {}) })),
        refundIfMetered, genJobId,
      )
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
    // Контекст делится надвое РАДИ КЭША, без потери содержания (замер 25.08:
    // каждый ход писал кэш заново и читал ноль — системный промпт менялся,
    // потому что собирался от последнего сообщения):
    //   • стабильная часть (материалы проекта, голос, примеры стиля) не зависит
    //     от вопроса → идёт в системный блок под cache_control и переиспользуется
    //     всеми ходами диалога;
    //   • найденные под КОНКРЕТНЫЙ вопрос фрагменты идут в сообщение пользователя,
    //     вне кэшируемого префикса — релевантность каждого хода сохраняется.
    let ragContext: RAGContext = { systemKnowledge: [], projectContext: [], styleExamples: [] }
    let queryMatches: RAGContext = { systemKnowledge: [], projectContext: [], styleExamples: [] }
    try {
      ;[ragContext, queryMatches] = await Promise.all([
        buildRAGContext('', projectId, undefined, { stableOnly: true }),
        buildRAGContext(lastMessage, projectId, undefined, { matchesOnly: true }),
      ])
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
7. ССЫЛКИ. Ты не открываешь ссылки — но НЕ отвечай «у меня нет доступа в интернет» и не проси прислать текст. Скажи, куда её вставить, чтобы система разобрала за тебя:
   • ссылка на залетевший рилз → раздел «Тренды» → блок «Залетевшие рилз — референсы» → вставить ссылку → «Добавить и разобрать». Система скачает рилз, расшифрует речь и разберёт формат, после чего ты увидишь этот разбор здесь и сможешь с ним работать.
   • ссылка на Instagram-аккаунт (свой или конкурента) → раздел «Материалы» → «Подключить Instagram» / «Добавить конкурентов».
   Если разборы рилзов уже есть в блоке «ЗАЛЕТЕВШИЕ РИЛЗЫ» выше — спокойно перечисляй их, выбирай под темы дня и предлагай адаптацию под голос блогера.
${genFormat ? `
═══ РЕЖИМ ГЕНЕРАЦИИ ЕДИНИЦЫ КОНТЕНТА (${genFormat}) ═══
Этот текст пользователь сохранит и опубликует как есть. Поэтому:
- Выдавай СРАЗУ только сам готовый текст контента, ничего лишнего.
- 🚫 НИКАКОГО JSON, фигурных скобок {}, ключей "key": или служебной разметки — только готовый человеческий текст. Для карусели/рилз/сторис разбивай на блоки ОБЫЧНЫМ текстом, каждый с новой строки (${(() => {
  const l = resolveContentLanguage(project)
  if (l === 'en') return '«Slide 1:», затем заголовок и текст; «Scene 1 (0-3 sec):», затем что на экране и озвучка — метки блоков тоже на английском'
  if (l === 'es') return '«Diapositiva 1:», затем заголовок и текст; «Escena 1 (0-3 seg):», затем что на экране и озвучка — метки блоков тоже на испанском'
  if (l === 'it') return '«Slide 1:», затем заголовок и текст; «Scena 1 (0-3 sec):», затем что на экране и озвучка — метки блоков тоже на итальянском'
  if (l === 'de') return '«Slide 1:», затем заголовок и текст; «Szene 1 (0-3 Sek):», затем что на экране и озвучка — метки блоков тоже на немецком'
  return '«Слайд 1:», затем заголовок и текст; «Сцена 1 (0-3 сек):», затем что на экране и озвучка'
})()}).
- НЕ начинай со вводных фраз («Окей», «Конечно», «Вот», «Держи», «Делаем», «Готово», «Отлично») и НЕ повторяй тему/задание перед текстом.
- НЕ добавляй комментарии после текста («Готово!», «Если нужно — поправлю», «Хочешь иначе?»).
- Первая строка ответа = первая строка контента. Последняя строка ответа = последняя строка контента.` : ''}

${baseSystem}${savedBlock}`

    const blocked = await meterGeneration()
    if (blocked) return blocked
    const genJobId = genFormat ? await createGenMailbox(user.id) : null

    // Найденные под ЭТОТ вопрос фрагменты прикладываем к последнему сообщению,
    // а не в системный промпт: система остаётся байт-в-байт одинаковой весь
    // диалог (кэш читается), а релевантность хода не теряется. Для модели набор
    // токенов тот же — меняется только их место в запросе.
    const matchesBlock = [
      ...queryMatches.systemKnowledge.map(c => c.chunk_text),
      ...queryMatches.projectContext.map(c => c.chunk_text),
    ].filter(Boolean).join('\n\n').slice(0, 12000)
    const outMessages: ChatMsg[] = messages.map((m, i) => {
      const isLast = i === messages.length - 1
      const content = isLast && matchesBlock
        ? `${m.content}\n\n[СПРАВОЧНЫЕ ФРАГМЕНТЫ ПО ЭТОМУ ВОПРОСУ — материалы проекта и методология, используй если уместно]\n${matchesBlock}`
        : m.content
      return { role: m.role, content, ...(isLast ? { images } : {}) }
    })
    return streamingChatResponse(systemPrompt, outMessages, refundIfMetered, genJobId)
  } catch (error) {
    console.error('Chat error:', error)
    // Сырец — в телеметрию (диагностика), клиенту — честный русский текст:
    // раньше msg уходил как есть и мог протащить текст провайдера.
    await captureException(error, { where: 'chat route' })
    return NextResponse.json(
      { error: 'Ассистент сейчас перегружен или временно недоступен — попробуй через минуту-две. Твоё сообщение не потерялось.' },
      { status: 503 },
    )
  }
}
