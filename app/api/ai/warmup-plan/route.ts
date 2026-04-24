import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/client'

export const maxDuration = 300

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const {
      projectId, productName, duration, startDate, funnelDesc,
      warmTypes, useCases, hooks, extraHooks, competitors,
    }: {
      projectId: string; productName: string; duration: number
      startDate?: string; funnelDesc: string; warmTypes: string[]
      useCases: boolean; hooks: string[]; extraHooks?: string; competitors?: string
    } = await request.json()

    // ── Load project ─────────────────────────────────────────────────────────
    const { data: project } = await supabase
      .from('projects')
      .select('id, name, niche, description, target_audience, instagram_url, telegram_url')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    // ── Load system knowledge vault ──────────────────────────────────────────
    let systemKnowledgeText = ''
    try {
      const { data: sysChunks } = await supabase
        .from('knowledge_chunks')
        .select('chunk_text')
        .order('created_at', { ascending: false })
        .limit(10)
      if (sysChunks && sysChunks.length > 0) {
        systemKnowledgeText = sysChunks.map(c => c.chunk_text as string).join('\n\n').slice(0, 3000)
      } else {
        const { data: vaultItems } = await supabase
          .from('knowledge_vault')
          .select('raw_content, content_type, title')
          .eq('processing_status', 'ready')
          .limit(5)
        if (vaultItems && vaultItems.length > 0) {
          systemKnowledgeText = vaultItems
            .filter(v => v.raw_content)
            .map(v => `[${v.content_type}] ${v.title}:\n${(v.raw_content ?? '').slice(0, 600)}`)
            .join('\n\n')
        }
      }
    } catch { /* vault unavailable */ }

    // ── Load project materials ───────────────────────────────────────────────
    const { data: chunks } = await supabase
      .from('project_chunks')
      .select('chunk_text, material_type')
      .eq('project_id', projectId)
      .limit(30)

    let materialsText = ''
    if (chunks && chunks.length > 0) {
      materialsText = chunks.map(c => `[${c.material_type}]: ${c.chunk_text}`).join('\n\n').slice(0, 5000)
    } else {
      const { data: rawMaterials } = await supabase
        .from('project_materials')
        .select('title, material_type, raw_content')
        .eq('project_id', projectId)
        .not('raw_content', 'is', null)
        .limit(10)
      if (rawMaterials && rawMaterials.length > 0) {
        materialsText = rawMaterials
          .map(m => `[${m.material_type}] ${m.title}:\n${(m.raw_content ?? '').slice(0, 500)}`)
          .join('\n\n')
      }
    }

    const { data: materials } = await supabase
      .from('project_materials')
      .select('title, material_type, processing_status')
      .eq('project_id', projectId)
    const materialsList = materials && materials.length > 0
      ? materials.map(m => `• ${m.material_type}: ${m.title} (${m.processing_status})`).join('\n')
      : ''

    // ── Phase lengths ────────────────────────────────────────────────────────
    const p1 = Math.round(duration * 0.25)
    const p2 = Math.round(duration * 0.25)
    const p3 = Math.round(duration * 0.25)
    const p4 = duration - p1 - p2 - p3
    const hooksText = hooks.length ? hooks.join(', ') : 'не выбраны'

    // ── Prompt ───────────────────────────────────────────────────────────────
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
Длительность прогрева: ${duration} дней${startDate ? ` (старт: ${startDate})` : ''}
Воронка продаж: ${funnelDesc}
Механики прогрева: ${warmTypes.join(', ')}
Кейсы клиентов: ${useCases ? 'есть, использовать' : 'нет'}
Смысловые крючки: ${hooksText}${extraHooks ? `\nДоп. смыслы от блогера: ${extraHooks}` : ''}${competitors ? `\nКонкуренты / отличия: ${competitors}` : ''}
${project.instagram_url ? `Instagram: ${project.instagram_url}` : ''}
${project.telegram_url ? `Telegram: ${project.telegram_url}` : ''}

${materialsList ? `═══════════════════════════════
ЗАГРУЖЕННЫЕ МАТЕРИАЛЫ (список)
═══════════════════════════════
${materialsList}` : ''}

${materialsText ? `═══════════════════════════════
СОДЕРЖИМОЕ МАТЕРИАЛОВ (используй как основу для смыслов)
═══════════════════════════════
${materialsText}` : '⚠️ Текстовые материалы не загружены или ещё обрабатываются. Составь план на основе ниши и продукта.'}

═══════════════════════════════
МЕТОДОЛОГИЯ (строго соблюдай)
═══════════════════════════════

ФАЗА 1 — ПРОГРЕВ НА НИШУ (дни 1–${p1}, ${p1} дней):
Задача: продать ИДЕЮ ниши. Человек ещё на уровне «а мне это вообще надо?»
Не про блогера, не про продукт — про то, почему ЭТА ТЕМА важна для жизни человека.
ВАЖНО: смыслы должны быть конкретно про нишу «${project.niche || productName}».

ФАЗА 2 — ПРОГРЕВ НА ЭКСПЕРТА (дни ${p1 + 1}–${p1 + p2}, ${p2} дней):
Задача: ответить на вопрос «почему именно этот человек?»
Раскрываем: история прихода в нишу, через что прошли, какие ошибки видели, с кем работали, закономерности, система мышления, кейсы.
Используй конкретные детали из материалов проекта если они есть.

ФАЗА 3 — ПРОГРЕВ НА ПРОДУКТ (дни ${p1 + p2 + 1}–${p1 + p2 + p3}, ${p3} дней):
Задача: продать логику продукта «${productName}», убрать страх непонятности.
Раскрываем: как устроен процесс, что внутри, этапы работы, логика метода, кому подходит / не подходит.

ФАЗА 4 — ОТРАБОТКА ВОЗРАЖЕНИЙ И ДОЖИМЫ (дни ${p1 + p2 + p3 + 1}–${duration}, ${p4} дней):
Задача: убрать последнее сопротивление.
Работа: возражения, страхи, кейсы похожих людей, дедлайн, FOMO, FAQ, живые отзывы.

═══════════════════════════════
ПРАВИЛА ГЕНЕРАЦИИ
═══════════════════════════════
1. Каждый смысл — КОНКРЕТНЫЙ для этой ниши и этого продукта. Ни одного шаблонного.
2. Используй реальные данные из материалов: конкретные боли аудитории, реальные результаты, специфику ниши.
3. НЕ ПИШИ: «Провокационный вопрос», «5 признаков что тебе нужно X», «Пост-диагностика». Это шаблоны.
4. Каждый день = 1 конкретный смысл (о чём говорить, что именно раскрывать).
5. Никаких форматов контента (не пиши пост/сторис/рилс).
6. Смыслы должны звучать как реальная тема для контента, а не как описание задачи.
7. Каждый смысл — конкретный, ёмкий, без воды.

Используй инструмент create_warmup_plan чтобы вернуть план.
Заполни все фазы полностью — каждый день от 1 до ${duration} должен быть в daily_plan соответствующей фазы.`

    // ── Call Claude with Tool Use — synchronous, returns complete JSON ────────
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      tools: [{
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
      }],
      tool_choice: { type: 'tool' as const, name: 'create_warmup_plan' },
      messages: [{ role: 'user', content: prompt }],
    })

    const toolBlock = response.content.find((b) => b.type === 'tool_use')
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      return NextResponse.json({ error: 'AI не вернул план. Попробуй ещё раз.' }, { status: 500 })
    }

    return NextResponse.json({ planData: toolBlock.input })

  } catch (error) {
    console.error('Warmup plan error:', error)
    const msg = error instanceof Error ? error.message : 'AI недоступен'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
