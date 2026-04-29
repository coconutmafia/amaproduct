import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/client'

export const maxDuration = 300

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const {
      projectId, productName, duration, startDate, endDate, salesOpenDate, productStartDate, warmupType,
      funnelDesc, warmTypes, useCases, hooks, hookTexts, extraHooks, competitors,
    }: {
      projectId: string; productName: string; duration: number
      startDate?: string; endDate?: string; salesOpenDate?: string; productStartDate?: string
      warmupType?: 'launch' | 'evergreen'
      funnelDesc: string; warmTypes: string[]
      useCases: boolean; hooks: string[]
      hookTexts?: Record<string, string>
      extraHooks?: string; competitors?: string
    } = await request.json()

    // ── Load project ─────────────────────────────────────────────────────────
    const { data: project } = await supabase
      .from('projects')
      .select('id, name, niche, description, target_audience, instagram_url, telegram_url')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single()
    if (!project) {
      console.error(`[warmup-plan] Project not found: id=${projectId} user=${user.id}`)
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }
    console.log(`[warmup-plan] Starting for project="${project.name}" user=${user.id} duration=${duration}`)

    // ── Load system knowledge vault ──────────────────────────────────────────
    let systemKnowledgeText = ''
    try {
      const { data: sysChunks } = await supabase
        .from('knowledge_chunks').select('chunk_text')
        .order('created_at', { ascending: false }).limit(10)
      if (sysChunks && sysChunks.length > 0) {
        systemKnowledgeText = sysChunks.map(c => c.chunk_text as string).join('\n\n').slice(0, 3000)
      } else {
        const { data: vaultItems } = await supabase
          .from('knowledge_vault').select('raw_content, content_type, title')
          .eq('processing_status', 'ready').limit(5)
        if (vaultItems && vaultItems.length > 0) {
          systemKnowledgeText = vaultItems.filter(v => v.raw_content)
            .map(v => `[${v.content_type}] ${v.title}:\n${(v.raw_content ?? '').slice(0, 600)}`).join('\n\n')
        }
      }
    } catch { /* vault unavailable */ }

    // ── Load project materials ───────────────────────────────────────────────
    const { data: chunks } = await supabase
      .from('project_chunks').select('chunk_text, material_type')
      .eq('project_id', projectId).limit(30)

    let materialsText = ''
    if (chunks && chunks.length > 0) {
      materialsText = chunks.map(c => `[${c.material_type}]: ${c.chunk_text}`).join('\n\n').slice(0, 5000)
    } else {
      const { data: rawMaterials } = await supabase
        .from('project_materials').select('title, material_type, raw_content')
        .eq('project_id', projectId).not('raw_content', 'is', null).limit(10)
      if (rawMaterials && rawMaterials.length > 0) {
        materialsText = rawMaterials
          .map(m => `[${m.material_type}] ${m.title}:\n${(m.raw_content ?? '').slice(0, 500)}`).join('\n\n')
      }
    }

    const { data: materials } = await supabase
      .from('project_materials').select('title, material_type, processing_status')
      .eq('project_id', projectId)
    const materialsList = materials?.length
      ? materials.map(m => `• ${m.material_type}: ${m.title} (${m.processing_status})`).join('\n') : ''

    // ── Phase lengths ────────────────────────────────────────────────────────
    const p1 = Math.round(duration * 0.25)
    const p2 = Math.round(duration * 0.25)
    const p3 = Math.round(duration * 0.25)
    const p4 = duration - p1 - p2 - p3
    const hooksText = hooks.length ? hooks.join(', ') : 'не выбраны'
    // Детали к каждому хуку (от пользователя)
    const hookDetailsText = hookTexts && Object.keys(hookTexts).length > 0
      ? '\n' + Object.entries(hookTexts)
          .filter(([, v]) => v.trim())
          .map(([k, v]) => `  — ${k}: ${v.trim()}`)
          .join('\n')
      : ''

    // Вычисляем, на какие дни приходятся открытие продаж и старт продукта (для триггеров)
    const isEvergreen = warmupType === 'evergreen'
    let launchDayInfo = ''
    if (!isEvergreen && startDate) {
      const parts: string[] = []

      if (salesOpenDate) {
        const salesDay = Math.round((new Date(salesOpenDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1
        if (salesDay > 0 && salesDay <= duration) {
          parts.push(`Дата открытия продаж: ${salesOpenDate} (день ${salesDay} из ${duration}).
В день открытия продаж (день ${salesDay}): специальный контент — «продажи открыты», призыв к действию, как записаться.`)
        }
      }

      if (productStartDate) {
        const productDay = Math.round((new Date(productStartDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1
        if (productDay > 0 && productDay <= duration) {
          parts.push(`Дата запуска продукта: ${productStartDate} (день ${productDay} из ${duration}).
За 3–5 дней ДО (дни ${Math.max(1, productDay - 5)}–${productDay - 1}): усиль триггер АЖИОТАЖА — сколько мест занято, как участники уже записываются, что происходит за кулисами.
В день запуска и 2–3 дня ПОСЛЕ (дни ${productDay}–${Math.min(duration, productDay + 3)}): триггер ОГРАНИЧЕННОСТИ — «осталось X мест», «продажи закроются через Y часов / дней», «ещё можно успеть».`)
        }
      }

      if (parts.length > 0) launchDayInfo = '\n' + parts.join('\n\n')
    }

    const prompt = `Ты — AI-продюсер запусков, работающий по методологии конкретного эксперта-маркетолога.
Создай ПЕРСОНАЛИЗИРОВАННЫЙ план прогрева — не шаблон, а конкретный план для этого блогера, его ниши и его продукта.

${systemKnowledgeText ? `═══════════════════════════════
МЕТОДОЛОГИЯ ЭКСПЕРТА (Source of Truth — приоритет над всем)
═══════════════════════════════
${systemKnowledgeText}
ВАЖНО: Применяй эту методологию при составлении плана.
` : ''}

═══════════════════════════════
ДАННЫЕ ПРОЕКТА
═══════════════════════════════
Продукт: ${productName}
Ниша блогера: ${project.niche || project.name}
Описание: ${project.description || 'не указано'}
Целевая аудитория: ${project.target_audience || 'не указана'}
Тип прогрева: ${isEvergreen ? 'Вечнозелёный (постоянный, без дедлайна — консультации/услуги)' : 'Под запуск (разовый, с датами)'}
Длительность прогрева: ${duration} дней${startDate ? ` (старт: ${startDate}` : ''}${endDate && !isEvergreen ? `, окончание: ${endDate}` : ''}${startDate ? ')' : ''}${salesOpenDate && !isEvergreen ? `\nОткрытие продаж: ${salesOpenDate}` : ''}${productStartDate && !isEvergreen ? `\nСтарт продукта: ${productStartDate}` : ''}${launchDayInfo}
Воронка продаж: ${funnelDesc}
Механики прогрева: ${warmTypes.join(', ')}
Кейсы клиентов: ${useCases ? 'есть, использовать' : 'нет'}
Смысловые крючки: ${hooksText}${hookDetailsText}${extraHooks ? `\nДоп. смыслы от блогера: ${extraHooks}` : ''}${competitors ? `\nКонкуренты / отличия: ${competitors}` : ''}
${project.instagram_url ? `Instagram: ${project.instagram_url}` : ''}
${project.telegram_url ? `Telegram: ${project.telegram_url}` : ''}

${materialsList ? `═══════════════════════════════
ЗАГРУЖЕННЫЕ МАТЕРИАЛЫ
═══════════════════════════════
${materialsList}` : ''}

${materialsText ? `═══════════════════════════════
СОДЕРЖИМОЕ МАТЕРИАЛОВ
═══════════════════════════════
${materialsText}` : '⚠️ Текстовые материалы не загружены. Составь план на основе ниши и продукта.'}

═══════════════════════════════
МЕТОДОЛОГИЯ
═══════════════════════════════
${isEvergreen ? `
ВЕЧНОЗЕЛЁНЫЙ ПРОГРЕВ (цикл ${duration} дней, повторяется):
Это НЕ запуск — нет дедлайна, нет «осталось мест». Цель: постоянно привлекать и греть аудиторию для покупки консультаций/услуг.

ФАЗА 1 — ПРОГРЕВ НА НИШУ (дни 1–${p1}, ${p1} дней):
Зачем этот эксперт, почему эта тема важна, какие проблемы решает.

ФАЗА 2 — ПРОГРЕВ НА ЭКСПЕРТА (дни ${p1 + 1}–${p1 + p2}, ${p2} дней):
История, опыт, кейсы, подход — «почему именно этот человек».

ФАЗА 3 — ПРОГРЕВ НА ПРОДУКТ (дни ${p1 + p2 + 1}–${p1 + p2 + p3}, ${p3} дней):
Как устроена работа, что получит клиент, типичный результат.

ФАЗА 4 — ПРИЗЫВ К ДЕЙСТВИЮ (дни ${p1 + p2 + p3 + 1}–${duration}, ${p4} дней):
Мягкий призыв записаться, ответы на частые вопросы, как начать работу.
` : `
ФАЗА 1 — ПРОГРЕВ НА НИШУ (дни 1–${p1}, ${p1} дней):
Задача: продать ИДЕЮ ниши. Человек ещё на уровне «а мне это вообще надо?»
ВАЖНО: смыслы должны быть конкретно про нишу «${project.niche || productName}».

ФАЗА 2 — ПРОГРЕВ НА ЭКСПЕРТА (дни ${p1 + 1}–${p1 + p2}, ${p2} дней):
Задача: ответить на вопрос «почему именно этот человек?»
Раскрываем: история, опыт, ошибки, кейсы, система мышления.

ФАЗА 3 — ПРОГРЕВ НА ПРОДУКТ (дни ${p1 + p2 + 1}–${p1 + p2 + p3}, ${p3} дней):
Задача: продать логику продукта «${productName}», убрать страх непонятности.

ФАЗА 4 — ОТРАБОТКА ВОЗРАЖЕНИЙ (дни ${p1 + p2 + p3 + 1}–${duration}, ${p4} дней):
Задача: убрать последнее сопротивление. Возражения, FOMO, дедлайн, FAQ.${launchDayInfo ? '\nОБЯЗАТЕЛЬНО включи триггеры ажиотажа и ограниченности в указанные дни рядом с датой запуска.' : ''}
`}

═══════════════════════════════
ПРАВИЛА
═══════════════════════════════
1. Каждый смысл — конкретный для этой ниши и продукта, ни одного шаблонного.
2. Используй данные из материалов проекта.
3. Каждый день = 1 конкретный смысл.
4. Никаких форматов контента (не пиши пост/сторис/рилс).

Используй инструмент create_warmup_plan.
Заполни все дни от 1 до ${duration}.`

    const toolDef = {
      name: 'create_warmup_plan',
      description: 'Создаёт структурированный план прогрева',
      input_schema: {
        type: 'object' as const,
        properties: {
          strategy_summary: { type: 'string' },
          phases: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                phase: { type: 'string' },
                label: { type: 'string' },
                days_count: { type: 'number' },
                task: { type: 'string' },
                daily_plan: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      day: { type: 'number' },
                      meaning: { type: 'string' },
                    },
                    required: ['day', 'meaning'],
                  },
                },
              },
              required: ['phase', 'label', 'days_count', 'task', 'daily_plan'],
            },
          },
        },
        required: ['strategy_summary', 'phases'],
      },
    }

    // ── Stream Claude response — каждый чанк сразу летит клиенту ────────────
    // Это держит TCP-соединение живым на мобильных сетях (убивают при 60+ сек тишины)
    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

        try {
          send({ type: 'status', message: 'Составляю план прогрева...' })

          // Стримим каждый чанк Claude → клиент видит данные сразу
          // TCP-соединение остаётся живым пока идёт генерация
          const claudeStream = anthropic.messages.stream({
            model: MODEL,
            max_tokens: 8000,
            tools: [toolDef],
            tool_choice: { type: 'tool' as const, name: 'create_warmup_plan' },
            messages: [{ role: 'user', content: prompt }],
          })

          // Каждый входящий чанк — отправляем heartbeat клиенту
          // Данные текут непрерывно → мобильная сеть не закрывает соединение
          for await (const chunk of claudeStream) {
            if (chunk.type === 'content_block_delta') {
              // Отправляем фактический прогресс генерации
              send({ type: 'progress' })
            }
          }

          const finalMessage = await claudeStream.finalMessage()
          const toolBlock = finalMessage.content.find(b => b.type === 'tool_use')

          if (!toolBlock || toolBlock.type !== 'tool_use') {
            console.error('[warmup-plan] No tool block in response, stop_reason:', finalMessage.stop_reason)
            send({ type: 'error', message: 'AI не вернул план. Попробуй ещё раз.' })
          } else {
            const planJson = JSON.stringify(toolBlock.input)
            const input = toolBlock.input as { strategy_summary?: string; phases?: unknown[] }
            // Validate plan completeness — truncated output (max_tokens hit) produces empty phases
            if (!input.phases || !Array.isArray(input.phases) || input.phases.length === 0) {
              console.error(`[warmup-plan] Incomplete plan (stop_reason=${finalMessage.stop_reason}), phases=${JSON.stringify(input.phases)}, size=${planJson.length}`)
              send({ type: 'error', message: 'AI не успел сформировать полный план. Попробуй ещё раз.' })
            } else {
              console.log(`[warmup-plan] Done, phases=${input.phases.length}, plan size=${planJson.length} bytes, stop_reason=${finalMessage.stop_reason}`)
              send({ type: 'done', planData: toolBlock.input })
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'AI недоступен'
          console.error('[warmup-plan] Stream error:', msg)
          send({ type: 'error', message: msg })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff',
      },
    })

  } catch (error) {
    console.error('Warmup plan error:', error)
    const msg = error instanceof Error ? error.message : 'Ошибка сервера'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
