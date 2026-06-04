import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/client'
import { buildRAGContext } from '@/lib/ai/rag'
import { buildSystemPrompt } from '@/lib/ai/prompts/system'
import {
  getSchemaForPhase,
  getEmotionalMechanics,
  getCTAEngine,
  HUMANIZATION_ENGINE,
  CONTENT_BRAIN_ANTI_PATTERNS,
  AI_TELLS_TO_AVOID,
} from '@/lib/ai/prompts/content-brain'
import { contentItemToText } from '@/lib/contentToText'
import { cleanMarkdown } from '@/lib/cleanText'
import { NextResponse } from 'next/server'
import type { WarmupPlanData, WarmupPhaseData } from '@/types'

export const maxDuration = 300

// A warmup plan reaches this route in two shapes:
//   • saved / content-plan:   { warmup_plan: { phases: [...] }, meta }
//   • wizard draft (aiPlanData): { strategy_summary, phases: [...] }
// Read the phases from wherever they live so the DRAFT editor (on the approval
// screen) doesn't wrongly report a perfectly good plan as «повреждён или пуст».
function getPlanPhases(planData: unknown): WarmupPhaseData[] {
  const pd = planData as { warmup_plan?: { phases?: unknown }; phases?: unknown } | null
  if (pd && Array.isArray(pd.warmup_plan?.phases)) return pd.warmup_plan!.phases as WarmupPhaseData[]
  if (pd && Array.isArray(pd.phases)) return pd.phases as WarmupPhaseData[]
  return []
}

// ── Banned phrases — merged with content brain anti-patterns ──────────────────
const BANNED_PHRASES = `
АБСОЛЮТНО ЗАПРЕЩЁННЫЕ ФРАЗЫ И ПАТТЕРНЫ:
❌ "уникальная возможность" / "уникальный шанс"
❌ "незабываемый опыт" / "трансформирующий опыт"
❌ "революционный подход" / "инновационный метод"
❌ "я рада/рад поделиться" / "хочу рассказать вам о..."
❌ "в современном мире" / "в наше время"
❌ "не упустите свой шанс" / "действуй прямо сейчас"
❌ Абстрактные обещания без цифр и реальных примеров
❌ Использование слова "эксперт" для описания самого блогера
❌ Любые формулировки которые звучат как реклама, а не как разговор
${CONTENT_BRAIN_ANTI_PATTERNS}

${AI_TELLS_TO_AVOID}
`.trim()

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { projectId, contextType, contextId, messages = [], instruction, draftPlanData, weekContext } = body
  // weekContext = which week of the content plan the user is currently viewing,
  // with the weekday→day-number mapping + current per-format briefs. Lets the AI
  // resolve relative references ("change Wednesday's stories") to the right
  // absolute day instead of guessing a number.
  type WeekDay = { day: number; date?: string; dayOfWeek?: string; phase?: string; briefs?: Record<string, string> }
  const wc = weekContext as { week?: number; days?: WeekDay[] } | undefined

  if (!projectId || !contextType || !instruction) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  // draftPlanData mode: editing an unsaved plan (in the wizard) — no contextId needed
  const isDraft = !!draftPlanData && contextType === 'warmup_plan'
  if (!isDraft && !contextId) {
    return NextResponse.json({ error: 'Missing contextId' }, { status: 400 })
  }

  // Load project
  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('owner_id', user.id)
    .single()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Load the document being edited
  let contextData: Record<string, unknown> = {}

  if (isDraft) {
    // Draft mode — use the plan data the client sent; no DB row exists yet
    contextData = { plan_data: draftPlanData }
  } else if (contextType === 'warmup_plan') {
    const { data } = await supabase
      .from('warmup_plans')
      .select('*')
      .eq('id', contextId)
      .eq('project_id', projectId)
      .single()
    if (!data) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    contextData = data
  } else if (contextType === 'content_item') {
    const { data } = await supabase
      .from('content_items')
      .select('*')
      .eq('id', contextId)
      .eq('project_id', projectId)
      .single()
    if (!data) return NextResponse.json({ error: 'Content item not found' }, { status: 404 })
    contextData = data
  } else {
    return NextResponse.json({ error: 'Unknown contextType' }, { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        let systemPrompt = ''
        let chatMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []

        // ── Build RAG context (always — for both warmup_plan and content_item) ─
        send({ type: 'status', message: 'Изучаю материалы проекта...' })

        let ragContext: Awaited<ReturnType<typeof buildRAGContext>> = {
          systemKnowledge: [],
          projectContext: [],
          styleExamples: [],
        }
        try {
          ragContext = await buildRAGContext(instruction, projectId, 'post')
        } catch { /* continue without RAG */ }

        // Extract sections from RAG context
        const tovChunks = ragContext.projectContext.filter(
          (c) => c.material_type === 'tone_of_voice' || c.material_type === 'tov'
        )
        const blogLineChunks = ragContext.projectContext.filter(
          (c) => c.material_type === 'blog_lines'
        )
        const casesChunks = ragContext.projectContext.filter(
          (c) => c.material_type === 'cases_reviews' || c.material_type === 'product_description'
        )
        const otherChunks = ragContext.projectContext.filter(
          (c) =>
            !['tone_of_voice', 'tov', 'blog_lines', 'cases_reviews', 'product_description'].includes(
              c.material_type || ''
            )
        )
        const methodologyChunks = ragContext.systemKnowledge

        // Build expert knowledge block (used in both modes)
        const expertKnowledge = [
          tovChunks.length > 0
            ? `═══ ГОЛОС ЭКСПЕРТА (Tone of Voice) ═══\n${tovChunks.map((c) => c.chunk_text).join('\n\n')}`
            : '',
          blogLineChunks.length > 0
            ? `═══ ЛИНИИ БЛОГА (личные истории и темы) ═══\n${blogLineChunks.map((c) => c.chunk_text).join('\n\n')}`
            : '',
          casesChunks.length > 0
            ? `═══ ПРОДУКТ И КЕЙСЫ ═══\n${casesChunks.map((c) => c.chunk_text).join('\n\n')}`
            : '',
          otherChunks.length > 0
            ? `═══ КОНТЕКСТ ПРОЕКТА ═══\n${otherChunks.map((c) => c.chunk_text).join('\n\n')}`
            : '',
          methodologyChunks.length > 0
            ? `═══ МЕТОДОЛОГИЯ ПРОГРЕВА ═══\n${methodologyChunks.map((c) => c.chunk_text).join('\n\n')}`
            : '',
          ragContext.styleExamples.length > 0
            ? `═══ ПРИМЕРЫ ОДОБРЕННОГО КОНТЕНТА (эталоны голоса) ═══\n${ragContext.styleExamples.map((ex, i) => `[Пример ${i + 1} · ${ex.content_type}]\n${ex.body_text}`).join('\n\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n\n')

        // ── Warmup plan editing ──────────────────────────────────────────────
        if (contextType === 'warmup_plan') {
          const planData = contextData.plan_data as WarmupPlanData
          const PHASE_LABELS: Record<string, string> = {
            niche: 'Прогрев на нишу', expert: 'Прогрев на эксперта',
            product: 'Прогрев на продукт', objections: 'Возражения',
            awareness: 'Знакомство', trust: 'Доверие',
            desire: 'Желание', close: 'Закрытие', activation: 'Активация',
          }

          // Guard: plan_data may be malformed / missing the expected shape.
          // Accept both the saved shape and the wizard-draft shape (see getPlanPhases).
          const planPhasesArr = getPlanPhases(planData)
          if (planPhasesArr.length === 0) {
            send({ type: 'error', message: 'План прогрева повреждён или пуст — пересоздай его в разделе «Стратегия».' })
            controller.close()
            return
          }

          // Format plan as readable lines grouped by phase, incl. per-format briefs
          const planLines: string[] = []
          for (const phase of planPhasesArr) {
            const phaseLabel = PHASE_LABELS[phase.phase] || phase.label || phase.phase
            for (const day of (Array.isArray(phase.daily_plan) ? phase.daily_plan : [])) {
              const d = day as unknown as Record<string, unknown>
              const meaning = (d.meaning as string) || (d.theme as string) || '—'
              let line = `День ${day.day} [${phaseLabel}]: ${meaning}`
              const briefs = d.briefs as Record<string, string> | undefined
              if (briefs && Object.keys(briefs).length > 0) {
                line += `\n  Темы по форматам → ${Object.entries(briefs).map(([f, t]) => `${f}: ${t}`).join(' | ')}`
              }
              planLines.push(line)
            }
          }

          // Content Brain: phase psychology for all unique phases in this plan
          const planPhases = [...new Set(
            planPhasesArr.map((p: { phase: string }) => p.phase)
          )] as string[]
          const planPhasePsychology = planPhases.map(ph => {
            return `[${ph.toUpperCase()}] ${getEmotionalMechanics(ph)}\n${getSchemaForPhase(ph, 'post')}\n${getCTAEngine(ph)}`
          }).join('\n\n')

          // Current-week focus: weekday → day-number mapping so relative day
          // references ("change Wednesday's stories") resolve to the week the
          // user is actually looking at, instead of the AI guessing a number.
          let weekViewBlock = ''
          if (wc && Array.isArray(wc.days) && wc.days.length > 0) {
            const dayLines = wc.days.map((d) => {
              const briefs = d.briefs && Object.keys(d.briefs).length > 0
                ? Object.entries(d.briefs).map(([f, t]) => `${f}: «${t}»`).join(' | ')
                : '—'
              return `${d.dayOfWeek ?? ''} ${d.date ?? ''} = День ${d.day} → ${briefs}`
            }).join('\n')
            weekViewBlock = `
═══════════════════════════════════════
ТЕКУЩИЙ ВИД ПОЛЬЗОВАТЕЛЯ — ОРИЕНТИРУЙСЯ НА НЕГО
═══════════════════════════════════════
Пользователь СЕЙЧАС открыл НЕДЕЛЮ ${wc.week ?? '?'} контент-плана. Дни этой недели (день недели = номер дня + текущие темы по форматам):
${dayLines}

КРИТИЧНО: если пользователь называет день недели (понедельник/вторник/среда/…) или говорит «эта неделя», «эту среду», «в среду», «сегодня» БЕЗ номера дня — это дни ТЕКУЩЕЙ недели из списка выше. Возьми соответствующий «День N» из этого списка и меняй ИМЕННО его. НЕ угадывай номер дня и НЕ бери день из другой недели. Если запрошенного дня недели нет в списке текущей недели — скажи об этом, а не подставляй чужой день.
`
          }

          systemPrompt = `Ты — AI-редактор плана прогрева. Ты досконально знаешь этого эксперта — его голос, его истории, его продукт — и вносишь правки, опираясь на реальные материалы, а не выдумывая.

${BANNED_PHRASES}

${expertKnowledge ? `═══════════════════════════════════════
ЧТО ТЫ ЗНАЕШЬ ОБ ЭКСПЕРТЕ
═══════════════════════════════════════
${expertKnowledge}` : ''}

═══════════════════════════════════════
ПСИХОЛОГИЯ ПРОГРЕВА ПО ФАЗАМ
═══════════════════════════════════════
${planPhasePsychology}

${HUMANIZATION_ENGINE}

═══════════════════════════════════════
РЕДАКТИРУЕМЫЙ ПЛАН
═══════════════════════════════════════
ПРОЕКТ: ${project.name}
${contextData.strategic_summary ? `СТРАТЕГИЯ: ${contextData.strategic_summary}\n` : ''}ПЛАН «${contextData.name}» (${contextData.duration_days} дней):

${planLines.join('\n')}
${weekViewBlock}
═══════════════════════════════════════
ПРАВИЛА РЕДАКТИРОВАНИЯ
═══════════════════════════════════════
1. Предлагай темы из РЕАЛЬНЫХ материалов эксперта: его кейсы, истории из линий блога, конкретные цифры — не выдуманные примеры.
2. Каждая тема — конкретна: "Кейс Анны: -12 кг за 8 недель без голодовки" лучше, чем "Результат клиента".
3. Соблюдай эмоциональную дугу фазы (см. ПСИХОЛОГИЯ выше) — не путай awareness с close.
4. Для каждого дня — выбери подходящую схему контента из психологии фазы.
5. Голос в теме дня — живой, из TOV. Не рекламный.
6. Кратко (1-2 предложения) объясни что меняешь и ПОЧЕМУ это лучше.
7. Верни изменённые дни СТРОГО в этом формате (одна строка, без переносов внутри тегов):
<changes>{"days":[{"day":N,"meaning":"новая тема дня","briefs":{"stories":"новая тема сторис","reels":"новая тема рилз"}}]}</changes>
   - "meaning" — общая тема дня (опционально, меняй если просят про весь день).
   - "briefs" — новые темы под КОНКРЕТНЫЕ форматы (post/stories/reels/carousel/email). Если пользователь просит изменить тему конкретного формата (например «другую тему для сторис на вторник») — меняй ИМЕННО его бриф в "briefs" (ключ — формат на латинице), а не общий meaning.
   - Можно вернуть только "briefs" без "meaning", или наоборот.
8. Если пользователь просто спрашивает или обсуждает — отвечай без блока <changes>.`

          chatMessages = [
            ...messages.map((m: { role: string; content: string }) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
            })),
            { role: 'user' as const, content: instruction },
          ]

        // ── Content item editing ─────────────────────────────────────────────
        } else if (contextType === 'content_item') {
          // Use full system prompt (voice + methodology + examples)
          const voicePrompt = buildSystemPrompt(ragContext, project)

          // Feed the AI a CLEAN readable text version — never raw JSON. Editing
          // against JSON.stringify(structured_data) made the model echo JSON/markdown
          // back (the "код" the user saw). contentItemToText flattens carousel /
          // reels / stories into plain readable text.
          const currentContent = contentItemToText({
            body_text: contextData.body_text as string | null | undefined,
            structured_data: contextData.structured_data,
          })

          // Infer what phase/day this content belongs to for context
          const phaseCtx = contextData.warmup_phase
            ? `Этап: ${contextData.warmup_phase}${contextData.day_number ? ` · День ${contextData.day_number}` : ''}`
            : ''

          systemPrompt = `${voicePrompt}

═══════════════════════════════════════
РЕЖИМ: РЕДАКТИРОВАНИЕ СУЩЕСТВУЮЩЕГО КОНТЕНТА
═══════════════════════════════════════
${phaseCtx}

ТЕКУЩИЙ ТЕКСТ:
${currentContent}

ЗАДАЧА:
1. Одним коротким предложением скажи что именно меняешь и почему это улучшит текст.
2. Верни ПОЛНЫЙ обновлённый текст (не только изменённую часть) в блоке:
<content>полный обновлённый текст здесь</content>

КРИТИЧНО:
- Меняй ТОЛЬКО то, что просит пользователь. Всё остальное — сохраняй дословно.
- Голос автора неприкосновенен — не «улучшай» стиль, который не просили трогать.
- Если текст содержит хештеги — сохрани их в конце.
- 🚫 Пиши ОБЫЧНЫМ ЧИТАЕМЫМ ТЕКСТОМ. НИКАКОГО JSON, фигурных скобок {}, кавычек-ключей "key":, markdown (**жирный**, ## заголовки, --- разделители, \`код\`). Пользователь видит этот текст как есть.
- Если это структурный контент (карусель / рилз / сторис) — разбивай на понятные блоки обычным текстом, каждый с новой строки и пустой строкой между блоками. Например: «Слайд 1:» затем заголовок и текст слайда; «Сцена 1 (0-3 сек):» затем что на экране и озвучка. Читаемо, как для человека, а не как данные.`

          chatMessages = [
            ...messages.map((m: { role: string; content: string }) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
            })),
            { role: 'user' as const, content: instruction },
          ]
        }

        // ── Stream Claude response ───────────────────────────────────────────
        send({ type: 'status', message: 'Думаю над правкой...' })

        const response = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 2048,
          system: systemPrompt,
          messages: chatMessages,
          stream: true,
        })

        let fullText = ''

        for await (const event of response) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            fullText += event.delta.text
            send({ type: 'text', delta: event.delta.text })
          }
        }

        // ── Parse result and update DB ───────────────────────────────────────
        if (contextType === 'warmup_plan') {
          const changesMatch = fullText.match(/<changes>([\s\S]*?)<\/changes>/)
          if (changesMatch) {
            try {
              const changes = JSON.parse(changesMatch[1].trim()) as {
                days?: Array<{ day: number; meaning?: string; briefs?: Record<string, string> }>
              }
              const planData = contextData.plan_data as WarmupPlanData
              const phases = getPlanPhases(planData)
              const changeDays = Array.isArray(changes.days) ? changes.days : []

              for (const change of changeDays) {
                for (const phase of phases) {
                  const dayEntry = (Array.isArray(phase.daily_plan) ? phase.daily_plan : []).find((d) => d.day === change.day)
                  if (dayEntry) {
                    const d = dayEntry as unknown as Record<string, unknown>
                    if (typeof change.meaning === 'string' && change.meaning.trim()) d.meaning = change.meaning
                    // Per-format brief edits — what the content plan actually displays
                    if (change.briefs && typeof change.briefs === 'object') {
                      const cur = (d.briefs as Record<string, string> | undefined) ?? {}
                      d.briefs = { ...cur, ...change.briefs }
                    }
                    break
                  }
                }
              }

              if (isDraft) {
                // Draft mode: nothing to save in DB — just return the
                // edited plan so the wizard can update its local state.
                send({ type: 'done', updatedData: { plan_data: planData }, changedDays: changeDays })
              } else {
                const { data: updatedPlan } = await supabase
                  .from('warmup_plans')
                  .update({ plan_data: planData })
                  .eq('id', contextId)
                  .select()
                  .single()

                send({ type: 'done', updatedData: updatedPlan, changedDays: changeDays })
              }
            } catch {
              send({ type: 'done', updatedData: contextData, changedDays: [] })
            }
          } else {
            send({ type: 'done', updatedData: contextData, changedDays: [] })
          }

        } else if (contextType === 'content_item') {
          const contentMatch = fullText.match(/<content>([\s\S]*?)<\/content>/)
          if (contentMatch) {
            // Safety net: strip any markdown the model slipped in (the user sees
            // this text raw). The edit turns the item into a clean-text item, so
            // drop structured_data — body_text is now the source of truth.
            const updatedText = cleanMarkdown(contentMatch[1].trim())
            const { data: updatedItem } = await supabase
              .from('content_items')
              .update({ body_text: updatedText, structured_data: null })
              .eq('id', contextId)
              .select()
              .single()
            send({ type: 'done', updatedData: updatedItem ?? {}, updatedText })
          } else {
            send({ type: 'done', updatedData: contextData, updatedText: null })
          }
        }

      } catch (error) {
        send({ type: 'error', message: error instanceof Error ? error.message : 'Ошибка сервера' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
