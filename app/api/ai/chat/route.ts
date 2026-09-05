import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { anthropic, MODEL, buildCachedSystemBlocks } from '@/lib/ai/client'
import { buildStandaloneChatContext, buildProjectChatContext, type ChatMsg } from '@/lib/ai/chatContext'
import { gateContentUnits, refundGenerations } from '@/lib/generations'
import { UNIT_COSTS } from '@/lib/generations-config'
import { estimateChatUnits, chargeChatByUsage, type ChatUsage } from '@/lib/billing/chatPricing'
import { getGenerationStats, BILLING_ENFORCED, isEntitled } from '@/lib/generations'
import { checkBudgetCap } from '@/lib/billing/costCap'
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
  systemBlocks: string[],
  messages: ChatMsg[],
  onEmptyError?: () => void | Promise<void>,
  genJobId?: string | null,
  // Честные единицы (05.09): по завершении ответа — фактический usage всех
  // раундов, по нему списываются единицы (см. chargeChatByUsage).
  onUsage?: (usages: ChatUsage[]) => unknown,
) {
  const encoder = new TextEncoder()
  // Кэш-брейкпоинт на последнем сообщении: следующий ход диалога и раунды
  // авто-продолжения читают систему+историю из кэша за ~10% цены вместо полной
  // (брейкпоинт на system покрывает только его, история шла по полной).
  // На выход не влияет — модель видит те же токены байт-в-байт.
  // TTL '1h', как у системного блока (см. buildCachedSystem): пауза человека
  // между сообщениями обычно длиннее 5 минут, и протухший брейкпоинт заставлял
  // переписывать систему+историю целиком по 1.25× — 84% цены чата были записи.
  // ЗАМЕРЕНО 04.09 (Даша, 33 сообщения): 77% цены чата — ЗАПИСЬ кэша, ~39k
  // токенов на ход. Причина: брейкпоинт стоял на ПОСЛЕДНЕМ сообщении, к
  // которому приклеены RAG-фрагменты этого хода; на следующем ходу то же
  // сообщение уходит уже без фрагментов → префикс истории расходится в этой
  // точке, и вся история переписывается по 2× цене. Теперь брейкпоинт — на
  // ПРЕДПОСЛЕДНЕМ сообщении (история читается из кэша по 0.1×), а последнее,
  // с переменными фрагментами, идёт после брейкпоинта и не пишется в кэш.
  // На следующем ходу записывается только новый хвост (~2k токенов).
  const cachedMessages = messages.map((m, i) => {
    const isLast = i === messages.length - 1
    const isBreakpoint = i === messages.length - 2
    if (isLast) {
      const imgs = imageBlocks(m.images)
      return {
        role: m.role,
        content: [
          ...imgs,
          { type: 'text' as const, text: m.content },
        ],
      }
    }
    if (isBreakpoint) {
      return {
        role: m.role,
        content: [{ type: 'text' as const, text: m.content, cache_control: { type: 'ephemeral' as const, ttl: '1h' as const } }],
      }
    }
    return { role: m.role, content: m.content }
  })
  const mailbox = async (patch: Record<string, unknown>) => {
    if (!genJobId) return
    try { await createAdminClient().from('jobs').update(patch).eq('id', genJobId) } catch { /* страховка */ }
  }
  const readable = new ReadableStream({
    async start(controller) {
      let acc = ''
      const usages: ChatUsage[] = []
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
          // Перегруз Anthropic (overloaded_error/529) в промо-дни приходит
          // пачками по 1-2 минуты (03-04.09: юзеры видели «Ошибка» и жали
          // повтор руками — повтор через минуту срабатывал). Пока из ТЕКУЩЕГО
          // раунда не пришло ни символа, повторяем его тихо до 2 раз с паузой —
          // юзер видит задержку в пару секунд вместо красной плашки.
          let final: { stop_reason: string | null } | null = null
          for (let attempt = 0; ; attempt++) {
            const roundStart = acc.length
            try {
              const stream = anthropic.messages.stream({ model: MODEL, max_tokens: 16000, system: buildCachedSystemBlocks(systemBlocks), messages: convo })
              for await (const chunk of stream) {
                if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                  acc += chunk.delta.text
                  controller.enqueue(encoder.encode(chunk.delta.text))
                }
              }
              final = await stream.finalMessage()
              usages.push((final as unknown as { usage: ChatUsage }).usage)
              break
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              const overloaded = /overloaded_error|Overloaded|\b529\b/i.test(msg)
              if (overloaded && attempt < 2 && acc.length === roundStart) {
                await new Promise(r => setTimeout(r, 2000 + attempt * 3000))
                continue
              }
              throw err
            }
          }
          if (final?.stop_reason !== 'max_tokens') break
        }
        // Полный ответ — в ящик (инвокация жива даже при умершей вкладке).
        await mailbox({ status: 'done', result: { text: acc, complete: true } })
        // Списание — ДО закрытия стрима: после close() ответ отдан, и serverless
        // засыпает, не дописав (ход 3 пробника 05.09 пропал из ленты).
        if (onUsage) { try { await onUsage(usages) } catch { /* списание не должно ронять ответ */ } }
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
          if (onUsage && usages.length) { try { await onUsage(usages) } catch { /* ignore */ } }
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
    let chatEstimate: { units: number } | null = null
    const meterGeneration = async (): Promise<Response | null> => {
      if (!genFormat) {
        // Свободный чат — ЧЕСТНЫЕ ЕДИНИЦЫ (05.09): вперёд ничего не списываем,
        // проверяем, что остатка хватит на оценку этого сообщения; списание —
        // по факту после ответа (chargeChatByUsage). Оценка считается по тем
        // же блокам, что уйдут в модель (chatEstimate заполняется ниже).
        if (!BILLING_ENFORCED) return null
        if (!(await isEntitled(user.id))) {
          return NextResponse.json({ error: 'payment_required', code: 'payment_required' }, { status: 402 })
        }
        const budget = await checkBudgetCap(user.id)
        if (budget.blocked) return NextResponse.json({ error: 'limit_reached', code: 'limit_reached' }, { status: 402 })
        const stats = await getGenerationStats(user.id)
        const need = chatEstimate?.units ?? 0.5
        if (stats.remaining < need) {
          return NextResponse.json(
            { error: 'limit_reached', code: 'limit_reached', needUnits: need, remaining: stats.remaining, monthlyUsed: stats.monthlyUsed, monthlyLimit: stats.monthlyLimit },
            { status: 402 },
          )
        }
        return null
      }
      const gate = await gateContentUnits(user.id, UNIT_COSTS.content, 'content')
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
      const { systemBlocks: standaloneBlocks } = await buildStandaloneChatContext(supabase, user.id, messages[messages.length - 1]?.content || '')

      const saMessages = messages.map((m, i) => ({ role: m.role, content: m.content, ...(i === messages.length - 1 ? { images } : {}) }))
      if (!genFormat) chatEstimate = await estimateChatUnits(standaloneBlocks.map(text => ({ type: 'text' as const, text })), saMessages.map(m => ({ role: m.role, content: m.content }))).catch(() => null)
      const blocked = await meterGeneration()
      if (blocked) return blocked
      const genJobId = genFormat ? await createGenMailbox(user.id) : null
      // «Готовое» — отдельным кэш-блоком (см. ветку с проектом ниже)
      return streamingChatResponse(
        standaloneBlocks,
        saMessages,
        refundIfMetered, genJobId,
        (usages) => chargeChatByUsage(user.id, usages, genFormat ? { action: 'content', minUnitsAlreadyCharged: UNIT_COSTS.content } : { action: 'chat' }),
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
    const { systemBlocks: projectBlocks, outMessages } = await buildProjectChatContext({
      supabase, userId: user.id, projectId, project, genFormat, messages, images,
    })
    if (!genFormat) chatEstimate = await estimateChatUnits(projectBlocks.map(text => ({ type: 'text' as const, text })), outMessages.map(m => ({ role: m.role, content: m.content }))).catch(() => null)
    const blocked = await meterGeneration()
    if (blocked) return blocked
    const genJobId = genFormat ? await createGenMailbox(user.id) : null
    // «Готовое» — отдельным кэш-блоком после стабильных материалов: юзер
    // сохраняет тексты по ходу диалога, и раньше каждое сохранение меняло
    // ЕДИНЫЙ system → перезапись всех материалов проекта.
    // Списание по факту: чат — вся себестоимость ответа в единицах; генерация
    // («пост = 2 ед.» списаны вперёд) — только превышение над фиксированной ценой.
    return streamingChatResponse(
      projectBlocks, outMessages, refundIfMetered, genJobId,
      (usages) => chargeChatByUsage(user.id, usages, genFormat ? { action: 'content', minUnitsAlreadyCharged: UNIT_COSTS.content } : { action: 'chat' }),
    )
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
