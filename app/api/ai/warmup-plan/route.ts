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

    // ── Load project data ────────────────────────────────────────────────────
    const { data: project } = await supabase
      .from('projects')
      .select('id, name, niche, description, target_audience, instagram_url, telegram_url')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    // ── Load system knowledge vault (expert methodology) ────────────────────
    let systemKnowledgeText = ''
    try {
      // Try chunks table first
      const { data: sysChunks } = await supabase
        .from('knowledge_chunks')
        .select('chunk_text')
        .order('created_at', { ascending: false })
        .limit(10)

      if (sysChunks && sysChunks.length > 0) {
        systemKnowledgeText = sysChunks.map(c => c.chunk_text as string).join('\n\n').slice(0, 3000)
      } else {
        // Fallback: load raw content from knowledge_vault
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
    } catch {
      // System vault unavailable — continue without it
    }

    // ── Load project materials (chunks first, fallback to raw) ───────────────
    const { data: chunks } = await supabase
      .from('project_chunks')
      .select('chunk_text, material_type')
      .eq('project_id', projectId)
      .limit(30)

    // If no chunks — load raw_content from project_materials directly
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

    // List of all uploaded materials (for AI context even without text)
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
Создаём спрос на категорию. Работа с осознанием ценности ниши.
Например: если ниша — маркетинг блогов, то говорим о том, что блог без системы не монетизируется, охваты ≠ деньги, контент без стратегии = хаос, можно годами вести блог и не понимать почему нет продаж.
ВАЖНО: смыслы должны быть конкретно про нишу «${project.niche || productName}».

ФАЗА 2 — ПРОГРЕВ НА ЭКСПЕРТА (дни ${p1 + 1}–${p1 + p2}, ${p2} дней):
Задача: ответить на вопрос «почему именно этот человек?»
После «тема важная» возникает фильтр: а кому доверять? Кто реально понимает?
Раскрываем: история прихода в нишу, через что прошли, какие ошибки видели, с кем работали, закономерности, система мышления, принципы, кейсы и результаты.
Переводим блогера из «очередной блог» → «человек с позицией, опытом и своей правдой».
Используй конкретные детали из материалов проекта если они есть.

ФАЗА 3 — ПРОГРЕВ НА ПРОДУКТ (дни ${p1 + p2 + 1}–${p1 + p2 + p3}, ${p3} дней):
Задача: продать логику продукта «${productName}», убрать страх непонятности.
Люди боятся не цены — они боятся непонятности. «А что там вообще будет? Мне подойдёт? Я справлюсь?»
Раскрываем: как устроен процесс, что внутри, этапы работы, логика метода, кому подходит / не подходит, результаты по пути, почему такая структура.
Продукт становится не коробкой, а понятной системой.

ФАЗА 4 — ОТРАБОТКА ВОЗРАЖЕНИЙ И ДОЖИМЫ (дни ${p1 + p2 + p3 + 1}–${duration}, ${p4} дней):
Задача: убрать последнее сопротивление. Человек уже почти внутри, но включаются мысли: «вдруг не получится», «вдруг дорого», «вдруг я уже пробовал», «сейчас не время».
Он выбирает не «нужно это или нет» — он выбирает «безопасно ли мне сказать да».
Работа: возражения, страхи, кейсы похожих людей, объяснение почему прошлый опыт мог не сработать, сравнение «войти vs остаться там же», дедлайн, FOMO, FAQ, живые отзывы.

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

═══════════════════════════════
ФОРМАТ ОТВЕТА
═══════════════════════════════
КРИТИЧЕСКИ ВАЖНО: Твой ответ должен начинаться с символа { и заканчиваться символом }.
Никаких слов до JSON, никаких слов после JSON, никаких markdown-обёрток, никаких комментариев.
ТОЛЬКО чистый JSON — первый символ { последний символ }.
Структура строго такая:

{
  "strategy_summary": "2-3 конкретных предложения об общей стратегии именно для этого блогера и этого продукта",
  "phases": [
    {
      "phase": "niche",
      "label": "ПРОГРЕВ НА НИШУ",
      "days_count": ${p1},
      "task": "Создать осознание — «эта тема важна для меня лично»",
      "daily_plan": [
        {"day": 1, "meaning": "конкретный смысл"},
        {"day": 2, "meaning": "конкретный смысл"}
      ]
    },
    {
      "phase": "expert",
      "label": "ПРОГРЕВ НА ЭКСПЕРТА",
      "days_count": ${p2},
      "task": "«Почему именно этот человек?» — экспертность, опыт, позиция",
      "daily_plan": [
        {"day": ${p1 + 1}, "meaning": "конкретный смысл"}
      ]
    },
    {
      "phase": "product",
      "label": "ПРОГРЕВ НА ПРОДУКТ",
      "days_count": ${p3},
      "task": "«Как именно это работает?» — механизм, структура, путь клиента",
      "daily_plan": [
        {"day": ${p1 + p2 + 1}, "meaning": "конкретный смысл"}
      ]
    },
    {
      "phase": "objections",
      "label": "ОТРАБОТКА ВОЗРАЖЕНИЙ И ДОЖИМЫ",
      "days_count": ${p4},
      "task": "Убрать последнее сопротивление — возражения, страхи, дедлайн, FOMO",
      "daily_plan": [
        {"day": ${p1 + p2 + p3 + 1}, "meaning": "конкретный смысл"}
      ]
    }
  ]
}`

    // ── Простой запрос — maxDuration=300 даёт Claude достаточно времени ─────
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })

    const rawText = response.content[0].type === 'text' ? response.content[0].text : ''

    if (!rawText) throw new Error('Пустой ответ от AI')

    let planData: unknown

    // Попытка 1: убираем markdown-фенсы и парсим
    try {
      const stripped = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim()
      planData = JSON.parse(stripped)
    } catch {
      // Попытка 2: ищем JSON-объект регуляркой (если Claude добавил текст вокруг)
      try {
        const match = rawText.match(/\{[\s\S]*\}/)
        if (!match) throw new Error('no match')
        planData = JSON.parse(match[0])
      } catch {
        console.error('JSON parse failed, raw start:', rawText.slice(0, 800))
        throw new Error('AI вернул некорректный формат. Попробуй ещё раз.')
      }
    }

    return NextResponse.json({ planData })

  } catch (error) {
    console.error('Warmup plan AI error:', error)
    let humanMsg = 'AI недоступен'
    if (error instanceof Error) {
      const raw = error.message
      try {
        const jsonStart = raw.indexOf('{')
        if (jsonStart !== -1) {
          const parsed = JSON.parse(raw.slice(jsonStart)) as { error?: { type?: string; message?: string } }
          const inner = parsed?.error?.message || ''
          if (inner) {
            if (inner.includes('credit') || inner.includes('balance')) humanMsg = 'Закончились кредиты Anthropic. Пополните баланс на console.anthropic.com'
            else if (inner.includes('credential') || inner.includes('API key') || inner.includes('auth')) humanMsg = 'Неверный API ключ Anthropic'
            else humanMsg = inner
          }
        } else {
          humanMsg = raw
        }
      } catch { humanMsg = raw }
    }
    return NextResponse.json({ error: humanMsg }, { status: 500 })
  }
}
