import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/client'
import { buildRAGContext } from '@/lib/ai/rag'
import { NextResponse } from 'next/server'

export const maxDuration = 90

interface BriefDay {
  day: number
  date: string
  phase: string
  meaning: string
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

  // 2. RAG for project context (TOV, cases, product) + system knowledge (methodology)
  let projectSummary = ''
  let systemKnowledge = ''
  try {
    const rag = await buildRAGContext('контент-план прогрев темы постов рилс сториз', projectId, 'post')
    const otherChunks = rag.projectContext.filter(c => c.material_type !== 'blog_lines')
    projectSummary = otherChunks.slice(0, 4).map(c => c.chunk_text).join('\n\n').slice(0, 800)
    systemKnowledge = rag.systemKnowledge.slice(0, 3).map(c => c.chunk_text).join('\n\n').slice(0, 1000)
  } catch { /* ignore */ }

  const daysText = days.map(d =>
    `День ${d.day} (${d.date}) — фаза: ${d.phase}, смысл: ${d.meaning || 'не задан'}`
  ).join('\n')

  const blogLinesInstruction = blogLinesSummary ? `
ЛИНИИ БЛОГА — личные истории и нарративы блогера:
${blogLinesSummary}

ОБЯЗАТЕЛЬНОЕ ПРАВИЛО ПРО ЛИНИИ БЛОГА:
Выбери 2–3 дня из недели где контент НАЧИНАЕТСЯ С ЛИЧНОЙ ИСТОРИИ из линий блога, а профессиональная тема вытекает из неё органично.
Пример правильно: "Рассказываю как переехала в Барселону с дочкой без связей и денег — и именно тогда поняла что микроблог важнее большой аудитории."
Пример НЕПРАВИЛЬНО: "Объясняю концепцию микроблога (с деталью про Барселону)" — это профессиональный пост с личной деталью, а не личная история.
Остальные дни — профессиональный контент, но с конкретными деталями из материалов.
` : ''

  const prompt = `Составь план контента на неделю для блогера. Верни ТОЛЬКО JSON, без markdown, без пояснений.

ПРОЕКТ: ${project.name}
НИША: ${project.niche || 'не указана'}
${project.description ? `ОПИСАНИЕ: ${project.description}` : ''}
${systemKnowledge ? `МЕТОДОЛОГИЯ ПРОГРЕВОВ (используй при планировании):\n${systemKnowledge}\n` : ''}
${projectSummary ? `МАТЕРИАЛЫ ПРОЕКТА (кейсы, продукт, TOV):\n${projectSummary}\n` : ''}
${blogLinesInstruction}
ДНИ НЕДЕЛИ:
${daysText}

ЗАДАЧА: для каждого дня пропиши конкретную тему каждой единицы контента (1–2 предложения). Если день строится на личной линии блога — начни тему с личной истории, профессиональный смысл должен вытекать из неё сам.

JSON формат (строго):
{"days":[{"day":1,"brief":{"post":"конкретная тема поста","stories":"конкретная тема сториз","reels":"конкретная тема рилса"}}]}`

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''

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
