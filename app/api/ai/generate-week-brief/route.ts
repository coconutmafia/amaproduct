import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/client'
import { buildRAGContext } from '@/lib/ai/rag'
import { getSchemaForPhase, getEmotionalMechanics, getCTAEngine } from '@/lib/ai/prompts/content-brain'
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

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('owner_id', user.id)
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
    projectSummary = otherChunks.slice(0, 4).map(c => c.chunk_text).join('\n\n').slice(0, 800)
    systemKnowledge = rag.systemKnowledge.slice(0, 3).map(c => c.chunk_text).join('\n\n').slice(0, 1000)
  } catch { /* ignore */ }

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

  const prompt = `Составь план контента на неделю для блогера. Верни ТОЛЬКО JSON, без markdown, без пояснений.

ПРОЕКТ: ${project.name}
НИША: ${project.niche || 'не указана'}
${project.description ? `ОПИСАНИЕ: ${project.description}` : ''}
${systemKnowledge ? `МЕТОДОЛОГИЯ ПРОГРЕВОВ:\n${systemKnowledge}\n` : ''}
${projectSummary ? `МАТЕРИАЛЫ ПРОЕКТА (кейсы, продукт, TOV):\n${projectSummary}\n` : ''}
${myInstagramSummary ? `АНАЛИЗ МОЕГО INSTAGRAM (опирайся на этот голос/темы при формулировках):\n${myInstagramSummary}\n` : ''}
${competitorsSummary ? `АНАЛИЗ INSTAGRAM КОНКУРЕНТОВ (что у них «заходит»; отстраивайся, не копируй):\n${competitorsSummary}\n` : ''}
${blogLinesInstruction}
─── ПСИХОЛОГИЯ КОНТЕНТА ПО ФАЗАМ ───────────────────────────
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
- Используй конкретику из материалов проекта: реальные кейсы, цифры, истории
- Если день строится на личной линии блога — начни с личной истории, смысл вытекает из неё

Возможные форматы: post, carousel, reels, stories, live, webinar, email.

JSON формат (строго) — ключи в brief берутся из «форматы:» каждого дня. Темы внутри одного дня должны быть про РАЗНЫЕ углы общей темы:
{"days":[{"day":1,"brief":{"post":"тема поста — один угол","reels":"тема рилса — ДРУГОЙ угол той же темы"}}]}`

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })

    // Scan ALL text blocks — newer Claude models can emit a thinking block
    // first, so content[0] is not reliably the text answer.
    const text = response.content.map(b => (b.type === 'text' ? b.text : '')).join('\n')

    // Extract JSON block
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('AI не вернул JSON')

    let jsonStr = jsonMatch[0]

    // Repair: replace unescaped double-quotes inside string values
    // Strategy: parse → if fails, try replacing inner quotes with curly quotes
    let data: Record<string, unknown>
    try {
      data = JSON.parse(jsonStr)
    } catch {
      // Replace any " that appear inside string values (between : " ... ") with «»
      jsonStr = jsonStr.replace(/:\s*"([\s\S]*?)"/g, (_match, inner: string) => {
        const fixed = inner.replace(/(?<!\\)"/g, '\\"')
        return `: "${fixed}"`
      })
      try {
        data = JSON.parse(jsonStr)
      } catch {
        // Last resort: strip all non-ASCII-safe chars and retry
        const safe = jsonStr.replace(/[^\x20-\x7EЀ-ӿ\n\r\t]/g, '')
        data = JSON.parse(safe)
      }
    }

    return NextResponse.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка AI'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
