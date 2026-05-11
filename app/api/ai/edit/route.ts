import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/client'
import { buildRAGContext } from '@/lib/ai/rag'
import { buildSystemPrompt } from '@/lib/ai/prompts/system'
import { NextResponse } from 'next/server'
import type { WarmupPlanData } from '@/types'

export const maxDuration = 60

// ── Banned phrases (same as main generator) ───────────────────────────────────
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
`.trim()

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { projectId, contextType, contextId, messages = [], instruction } = body

  if (!projectId || !contextType || !contextId || !instruction) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
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

  if (contextType === 'warmup_plan') {
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

          // Format plan as readable lines grouped by phase
          const planLines: string[] = []
          for (const phase of planData.warmup_plan.phases) {
            const phaseLabel = PHASE_LABELS[phase.phase] || phase.label || phase.phase
            for (const day of phase.daily_plan) {
              const d = day as unknown as Record<string, unknown>
              const meaning = (d.meaning as string) || (d.theme as string) || '—'
              planLines.push(`День ${day.day} [${phaseLabel}]: ${meaning}`)
            }
          }

          systemPrompt = `Ты — AI-редактор плана прогрева. Ты досконально знаешь этого эксперта — его голос, его истории, его продукт — и вносишь правки, опираясь на реальные материалы, а не выдумывая.

${BANNED_PHRASES}

${expertKnowledge ? `═══════════════════════════════════════
ЧТО ТЫ ЗНАЕШЬ ОБ ЭКСПЕРТЕ
═══════════════════════════════════════
${expertKnowledge}` : ''}

═══════════════════════════════════════
РЕДАКТИРУЕМЫЙ ПЛАН
═══════════════════════════════════════
ПРОЕКТ: ${project.name}
${contextData.strategic_summary ? `СТРАТЕГИЯ: ${contextData.strategic_summary}\n` : ''}ПЛАН «${contextData.name}» (${contextData.duration_days} дней):

${planLines.join('\n')}

═══════════════════════════════════════
ПРАВИЛА РЕДАКТИРОВАНИЯ
═══════════════════════════════════════
1. Предлагай темы из РЕАЛЬНЫХ материалов эксперта: его кейсы, истории из линий блога, конкретные цифры, реальные ситуации клиентов — не выдуманные примеры.
2. Каждая тема дня должна быть конкретной: "Кейс Анны: -12 кг за 8 недель без голодовки" лучше, чем "Результат клиента".
3. Соблюдай логику фазы: в фазе "на нишу" — продаём идею темы, в "на эксперта" — история и путь, в "на продукт" — механизм и результат, в "возражения" — снимаем страхи.
4. Голос в теме дня должен отражать голос эксперта (из TOV выше) — живой, не рекламный.
5. Ответь по-русски. Кратко (1-2 предложения) объясни что меняешь и ПОЧЕМУ это лучше.
6. Верни изменённые дни СТРОГО в этом формате (одна строка, без переносов внутри тегов):
<changes>{"days":[{"day":N,"meaning":"новая тема дня"}]}</changes>
7. Если пользователь просто спрашивает или обсуждает — отвечай без блока <changes>.`

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

          const currentContent =
            (contextData.body_text as string) ||
            (contextData.structured_data
              ? JSON.stringify(contextData.structured_data, null, 2)
              : '')

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
- Если текст содержит хештеги — сохрани их в конце.`

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
                days: Array<{ day: number; meaning: string }>
              }
              const planData = contextData.plan_data as WarmupPlanData

              for (const change of changes.days) {
                for (const phase of planData.warmup_plan.phases) {
                  const dayEntry = phase.daily_plan.find((d) => d.day === change.day)
                  if (dayEntry) {
                    const d = dayEntry as unknown as Record<string, unknown>
                    d.meaning = change.meaning
                    break
                  }
                }
              }

              const { data: updatedPlan } = await supabase
                .from('warmup_plans')
                .update({ plan_data: planData })
                .eq('id', contextId)
                .select()
                .single()

              send({ type: 'done', updatedData: updatedPlan, changedDays: changes.days })
            } catch {
              send({ type: 'done', updatedData: contextData, changedDays: [] })
            }
          } else {
            send({ type: 'done', updatedData: contextData, changedDays: [] })
          }

        } else if (contextType === 'content_item') {
          const contentMatch = fullText.match(/<content>([\s\S]*?)<\/content>/)
          if (contentMatch) {
            const updatedText = contentMatch[1].trim()
            const { data: updatedItem } = await supabase
              .from('content_items')
              .update({ body_text: updatedText })
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
