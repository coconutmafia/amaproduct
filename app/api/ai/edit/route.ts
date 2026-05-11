import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/client'
import { buildRAGContext } from '@/lib/ai/rag'
import { buildSystemPrompt } from '@/lib/ai/prompts/system'
import { NextResponse } from 'next/server'
import type { WarmupPlanData } from '@/types'

export const maxDuration = 60

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

        // ── Warmup plan editing ──────────────────────────────────────────────
        if (contextType === 'warmup_plan') {
          const planData = contextData.plan_data as WarmupPlanData
          const PHASE_LABELS: Record<string, string> = {
            niche: 'Прогрев на нишу', expert: 'Прогрев на эксперта',
            product: 'Прогрев на продукт', objections: 'Возражения',
            awareness: 'Знакомство', trust: 'Доверие',
            desire: 'Желание', close: 'Закрытие', activation: 'Активация',
          }

          // Format plan as readable lines
          const planLines: string[] = []
          for (const phase of planData.warmup_plan.phases) {
            const phaseLabel = PHASE_LABELS[phase.phase] || phase.label || phase.phase
            for (const day of phase.daily_plan) {
              const d = day as unknown as Record<string, unknown>
              const meaning = (d.meaning as string) || (d.theme as string) || '—'
              planLines.push(`День ${day.day} [${phaseLabel}]: ${meaning}`)
            }
          }

          systemPrompt = `Ты — AI-редактор плана прогрева. Вносишь точечные правки по запросу.

ПРОЕКТ: ${project.name}${contextData.strategic_summary ? `\nСТРАТЕГИЯ: ${contextData.strategic_summary}` : ''}
НАЗВАНИЕ ПЛАНА: ${contextData.name}
ДЛИТЕЛЬНОСТЬ: ${contextData.duration_days} дней

ТЕКУЩИЙ ПЛАН:
${planLines.join('\n')}

ИНСТРУКЦИИ:
1. Ответь по-русски. Кратко (1-2 предложения) объясни что меняешь.
2. Затем верни изменённые дни СТРОГО в этом формате (без переноса строк внутри тегов):
<changes>{"days":[{"day":N,"meaning":"новая тема"}]}</changes>
3. Тема дня — конкретная, образная, 1-2 предложения. Сохраняй стратегическую логику фазы.
4. Если пользователь не просит конкретных изменений (просто спрашивает) — отвечай без блока <changes>.`

          chatMessages = [
            ...messages.map((m: { role: string; content: string }) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
            })),
            { role: 'user' as const, content: instruction },
          ]

        // ── Content item editing ─────────────────────────────────────────────
        } else if (contextType === 'content_item') {
          send({ type: 'status', message: 'Загружаю контекст проекта...' })

          let ragContext: Awaited<ReturnType<typeof buildRAGContext>> = { systemKnowledge: [], projectContext: [], styleExamples: [] }
          try {
            ragContext = await buildRAGContext(instruction, projectId, contextData.content_type as string)
          } catch { /* continue without RAG */ }

          const voicePrompt = buildSystemPrompt(ragContext, project)
          const currentContent = (contextData.body_text as string) ||
            (contextData.structured_data ? JSON.stringify(contextData.structured_data, null, 2) : '')

          systemPrompt = `${voicePrompt}

---
ТЕКУЩИЙ КОНТЕНТ ДЛЯ РЕДАКТИРОВАНИЯ:
${currentContent}

ЗАДАЧА РЕДАКТОРА:
1. Одним предложением скажи что меняешь (по-русски).
2. Верни ПОЛНЫЙ обновлённый текст в блоке:
<content>полный обновлённый текст здесь</content>
Сохраняй голос автора, стиль и структуру. Меняй только то, что просит пользователь.`

          chatMessages = [
            ...messages.map((m: { role: string; content: string }) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
            })),
            { role: 'user' as const, content: instruction },
          ]
        }

        // ── Stream Claude response ───────────────────────────────────────────
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
              const changes = JSON.parse(changesMatch[1].trim()) as { days: Array<{ day: number; meaning: string }> }
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
            // No changes block — just a conversational reply
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
            send({ type: 'done', updatedData: updatedItem, updatedText })
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
