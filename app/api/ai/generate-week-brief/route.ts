import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL, buildCachedSystem } from '@/lib/ai/client'
import { buildRAGContext } from '@/lib/ai/rag'
import { getSchemaForPhase, getEmotionalMechanics, getCTAEngine } from '@/lib/ai/prompts/content-brain'
import { requireProjectAccess } from '@/lib/projects/access'
import { NextResponse } from 'next/server'

export const maxDuration = 90

interface BriefDay {
  day: number
  date: string
  phase: string
  meaning: string
  formats?: string[] // content formats the user chose for this day
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { projectId, days } = await request.json() as { projectId: string; days: BriefDay[] }

  const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Helper: strip characters that break JSON strings when AI mirrors them back
  const sanitizeForPrompt = (text: string) =>
    text.replace(/"/g, "'").replace(/\\/g, '/').replace(/[\x00-\x1F\x7F]/g, ' ')

  // 1. Direct query for blog_lines — bypass RAG chunking (blog_lines live in project_materials, not chunks)
  let blogLinesSummary = ''
  try {
    const { data: blogMaterials } = await supabase
      .from('project_materials')
      .select('raw_content, title')
      .eq('project_id', projectId)
      .eq('material_type', 'blog_lines')
      .limit(5)

    if (blogMaterials && blogMaterials.length > 0) {
      blogLinesSummary = blogMaterials
        .filter(m => m.raw_content)
        .map(m => sanitizeForPrompt(m.raw_content as string))
        .join('\n\n')
        .slice(0, 2000)
    }
  } catch { /* ignore */ }

  // 1b. Direct query for Instagram analysis (own + competitors) — same reason:
  //     these materials are voice/positioning gold and must always reach the
  //     prompt regardless of chunking state.
  let myInstagramSummary = ''
  let competitorsSummary = ''
  try {
    const { data: igMats } = await supabase
      .from('project_materials')
      .select('title, material_type, raw_content')
      .eq('project_id', projectId)
      .in('material_type', ['my_instagram', 'competitors'])
      .limit(6)
    if (igMats && igMats.length > 0) {
      const own = igMats.filter(m => m.material_type === 'my_instagram')
      const ext = igMats.filter(m => m.material_type === 'competitors')
      myInstagramSummary  = own.map(m => `${m.title}: ${sanitizeForPrompt((m.raw_content as string) ?? '').slice(0, 1800)}`).join('\n\n')
      competitorsSummary  = ext.map(m => `${m.title}: ${sanitizeForPrompt((m.raw_content as string) ?? '').slice(0, 1200)}`).join('\n\n').slice(0, 4500)
    }
  } catch { /* ignore */ }

  // 2. RAG for project context (TOV, cases, product) + system knowledge (methodology)
  let projectSummary = ''
  let systemKnowledge = ''
  try {
    const rag = await buildRAGContext('контент-план прогрев темы постов рилс сториз', projectId, 'post')
    const otherChunks = rag.projectContext.filter(c => c.material_type !== 'blog_lines')
    // Was 4 chunks × 800 chars total — cases/product rarely reached the plan and
    // themes came out generic. The block now rides in a CACHED system, so the
    // bigger context costs ~10% input price on repeat generations.
    projectSummary = otherChunks.slice(0, 10).map(c => c.chunk_text).join('\n\n').slice(0, 3500)
    systemKnowledge = rag.systemKnowledge.slice(0, 4).map(c => c.chunk_text).join('\n\n').slice(0, 1500)
  } catch { /* ignore */ }

  // ── Monthly trends / "актуалочки" (owner-curated) ──────────────────────────
  // Active trends matching the project's niche (or all-niche) are woven into
  // the week. Defensive: if the table doesn't exist yet, just skip.
  let trendsBlock = ''
  try {
    const niche = (project.niche || '').toLowerCase()
    // System trends (owner-curated, matched by niche) + this project's own trends.
    const { data: sysTrends } = await supabase
      .from('content_trends')
      .select('title, description, example, format_type, niches')
      .eq('scope', 'system').eq('is_active', true)
      .order('created_at', { ascending: false }).limit(12)
    const { data: projTrends } = await supabase
      .from('content_trends')
      .select('title, description, example, format_type, niches')
      .eq('scope', 'project').eq('project_id', projectId).eq('is_active', true)
      .order('created_at', { ascending: false }).limit(10)
    {
      const matchedSys = (sysTrends ?? []).filter(t => {
        const ns = (t.niches as string[] | null)
        if (!ns || ns.length === 0) return true // all niches
        return ns.some(n => niche.includes(n.toLowerCase()) || n.toLowerCase().includes(niche))
      })
      const relevant = [...(projTrends ?? []), ...matchedSys].slice(0, 5) // project's own first
      if (relevant.length > 0) {
        trendsBlock = `
─── АКТУАЛЬНЫЕ ТРЕНДЫ / ФОРМАТЫ МЕСЯЦА ──────────────────────
Впиши 1–2 из этих трендов в подходящие дни недели (не во все — естественно, где тема ложится).
Адаптируй тренд под нишу и голос блогера, не копируй шаблон механически. В теме дня кратко обозначь, что это [тренд].
${relevant.map(t => `• ${t.title}${t.format_type !== 'any' ? ` (${t.format_type})` : ''}: ${t.description}${t.example ? ` Пример: ${t.example}` : ''}`).join('\n')}
────────────────────────────────────────────────────────────`
      }
    }
  } catch { /* table missing or error — skip trends */ }

  // ── Viral reel references (real залетевшие reels, analysed) ────────────────
  // System reels matching the niche + this project's own reels → weave a
  // similar reel format into a day.
  let reelsBlock = ''
  try {
    const niche = (project.niche || '').toLowerCase()
    const { data: sysReels } = await supabase
      .from('viral_reels').select('reel_type, analysis, niches')
      .eq('scope', 'system').eq('is_active', true).limit(20)
    const { data: projReels } = await supabase
      .from('viral_reels').select('reel_type, analysis, niches')
      .eq('scope', 'project').eq('project_id', projectId).limit(10)
    const matchedSys = (sysReels ?? []).filter(r => {
      const ns = r.niches as string[] | null
      if (!ns || ns.length === 0) return true
      return ns.some(n => niche.includes(n.toLowerCase()) || n.toLowerCase().includes(niche))
    })
    const all = [...(projReels ?? []), ...matchedSys].slice(0, 4)
    if (all.length > 0) {
      reelsBlock = `
─── ВИРАЛЬНЫЕ РИЛЗ-РЕФЕРЕНСЫ (реальные, что залетели) ───────
Это реальные успешные рилз. Впиши 1–2 РИЛЗ-дня по их формату — возьми ПРИНЦИП (хук, структуру, почему зашло) и адаптируй под нишу и голос этого блогера. Не копируй дословно.
${all.map(r => `• ${r.reel_type}: ${(r.analysis ?? '').slice(0, 400)}`).join('\n')}
────────────────────────────────────────────────────────────`
    }
  } catch { /* table missing — skip */ }

  // Group unique phases in this week for content brain injection
  const uniquePhases = [...new Set(days.map(d => d.phase))]
  const phasePsychology = uniquePhases.map(phase => {
    const emotions = getEmotionalMechanics(phase)
    const schema   = getSchemaForPhase(phase, 'post')
    const cta      = getCTAEngine(phase)
    return `--- ФАЗА «${phase.toUpperCase()}» ---\n${emotions}\n${schema}\n${cta}`
  }).join('\n\n')

  // The user picks which content formats they want per day — generate briefs
  // ONLY for those, never the post/stories/reels default.
  const dayFormats = (d: BriefDay): string[] =>
    (d.formats && d.formats.length > 0) ? d.formats : ['post', 'stories', 'reels']

  const daysText = days.map(d =>
    `День ${d.day} (${d.date}) — фаза: ${d.phase}, смысл: ${d.meaning || 'не задан'}, форматы: ${dayFormats(d).join(', ')}`
  ).join('\n')

  const blogLinesInstruction = blogLinesSummary ? `
НАРРАТИВНЫЕ ЛИНИИ БЛОГА:
${blogLinesSummary}

ПРАВИЛО: если в смысле дня есть метка [ЛИНИЯ: название] — этот день строится ВОКРУГ ЛИЧНОЙ ИСТОРИИ из этой линии. Профессиональный смысл вытекает из истории, не наоборот.
Для таких дней тема поста НАЧИНАЕТСЯ с личного эпизода, а не с экспертного тезиса.
` : ''

  // Static project context → cached system block (stable across the plan's
  // weeks for the same project → week 2+ briefs read it at ~10% input price).
  // Volatile parts (phases of THIS week, days, task) stay in the user message.
  const systemBlock = `Составь план контента на неделю для блогера. Заполни инструмент week_brief: для каждого дня по одному элементу на каждый его формат.

ПРОЕКТ: ${project.name}
НИША: ${project.niche || 'не указана'}
${project.description ? `ОПИСАНИЕ: ${project.description}` : ''}
${systemKnowledge ? `МЕТОДОЛОГИЯ ПРОГРЕВОВ:\n${systemKnowledge}\n` : ''}
${projectSummary ? `МАТЕРИАЛЫ ПРОЕКТА (кейсы, продукт, TOV):\n${projectSummary}\n` : ''}
${myInstagramSummary ? `АНАЛИЗ МОЕГО INSTAGRAM (опирайся на этот голос/темы при формулировках):\n${myInstagramSummary}\n` : ''}
${competitorsSummary ? `АНАЛИЗ INSTAGRAM КОНКУРЕНТОВ (что у них «заходит»; отстраивайся, не копируй):\n${competitorsSummary}\n` : ''}
${blogLinesInstruction}
${trendsBlock}
${reelsBlock}`

  const prompt = `─── ПСИХОЛОГИЯ КОНТЕНТА ПО ФАЗАМ ───────────────────────────
${phasePsychology}
────────────────────────────────────────────────────────────

ДНИ НЕДЕЛИ:
${daysText}

ЗАДАЧА: для каждого дня пропиши конкретную тему (1–2 предложения) ТОЛЬКО для тех форматов, которые указаны в строке этого дня.
- ВАЖНО: в объекте brief для дня должны быть ТОЛЬКО форматы из списка «форматы:» этого дня. Не добавляй форматы, которых там нет.

🎯 ГЛАВНОЕ ПРАВИЛО ДНЯ С НЕСКОЛЬКИМИ ФОРМАТАМИ:
Когда в дне несколько единиц контента (например пост + сторис + рилз) — у них ОДНА общая тема дня (смысл дня), но КАЖДАЯ единица раскрывает её под СВОИМ УГЛОМ. НЕ дублируй одну и ту же мысль в разных форматах.
Распредели роли так, чтобы форматы дополняли друг друга, а не повторяли:
- ПОСТ: глубоко, текстом — личная история / разбор / экспертная позиция по теме дня.
- РИЛЗ: динамично, визуально — один яркий аспект темы (хук, инсайт, мини-история, миф).
- СТОРИС: лично и интерактивно — закулисье/реакция/опрос по теме, вовлечение аудитории.
- КАРУСЕЛЬ: пошаговый разбор/чеклист по теме дня.
- EMAIL: расширенная личная версия темы письмом.
Пример (тема дня «почему системность важнее вдохновения»): пост = личная история как хаос чуть не убил проект; рилз = «3 признака что ты работаешь на вдохновении» быстрым перечнем; сторис = опрос «ты планируешь контент или по настроению?» + закулисье своей системы. Тема одна — углы разные.

- Тема должна соответствовать эмоциональной дуге своей фазы (см. выше)
- Для поста — выбери подходящую схему контента из фазы и отрази её в теме
- 🚫 НЕ ВЫДУМЫВАЙ кейсы, имена клиентов и цифры. Если приводишь пример — бери ТОЛЬКО реальные кейсы/цифры из материалов проекта. Если конкретных данных нет — описывай тему/угол без выдуманных имён и сумм («личная история про…», «разбор ситуации когда…»), а не «клиентка Лена с 1200 подписчиков сделала 380 000».
- Бриф — это КОРОТКОЕ описание угла/смысла (1–2 предложения), а не готовый пост. Не пиши конкретные числа, которых нет в материалах.
- Если день строится на личной линии блога — начни с личной истории, смысл вытекает из неё

Возможные форматы: post, carousel, reels, stories, live, webinar, email.

ВАЖНО: для каждого дня в items добавь по одному элементу на КАЖДЫЙ формат из строки «форматы:» этого дня (и только на них). Темы внутри одного дня — про РАЗНЫЕ углы общей темы дня.`

  try {
    // Use a forced tool call — guarantees valid JSON (no fragile string-repair
    // of free-form output, which was throwing 'Expected , or ]' parse errors).
    const toolDef = {
      name: 'week_brief',
      description: 'Темы контента по дням и форматам на неделю',
      input_schema: {
        type: 'object' as const,
        properties: {
          days: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                day: { type: 'number' },
                items: {
                  type: 'array',
                  description: 'По одному элементу на каждый формат этого дня',
                  items: {
                    type: 'object',
                    properties: {
                      format: { type: 'string', description: 'post | carousel | reels | stories | live | webinar | email' },
                      theme:  { type: 'string', description: 'конкретная тема под этот формат (свой угол общей темы дня)' },
                    },
                    required: ['format', 'theme'],
                  },
                },
              },
              required: ['day', 'items'],
            },
          },
        },
        required: ['days'],
      },
    }

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      tools: [toolDef],
      tool_choice: { type: 'tool' as const, name: 'week_brief' },
      system: buildCachedSystem(systemBlock),
      messages: [{ role: 'user', content: prompt }],
    })

    const toolBlock = response.content.find(b => b.type === 'tool_use')
    if (!toolBlock || toolBlock.type !== 'tool_use') throw new Error('AI не вернул план недели')

    // Sonnet usually returns `days` as a native array, but it INTERMITTENTLY
    // serializes the nested array (or a single day's `items`) as a JSON STRING
    // instead. Without this, a perfectly good response 500s as "пустой план".
    // Accept both shapes everywhere we expect an array.
    const toArray = (v: unknown): unknown[] => {
      if (Array.isArray(v)) return v
      if (typeof v === 'string') {
        try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] }
      }
      return []
    }

    const input = toolBlock.input as { days?: unknown }
    const rawDays = toArray(input.days) as Array<{ day: number; items?: unknown }>
    if (rawDays.length === 0) {
      throw new Error('AI вернул пустой план — попробуй ещё раз')
    }

    // Reshape {day, items:[{format,theme}]} → {day, brief:{format: theme}}
    const days = rawDays.map(d => {
      const brief: Record<string, string> = {}
      for (const it of toArray(d.items) as Array<{ format?: string; theme?: string }>) {
        if (it?.format && it?.theme) brief[it.format] = it.theme
      }
      return { day: d.day, brief }
    })

    return NextResponse.json({ days })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка AI'
    console.error('[generate-week-brief] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
