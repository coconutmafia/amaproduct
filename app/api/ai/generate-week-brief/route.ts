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

  // Get RAG context — extract blog lines and other materials separately
  let projectSummary = ''
  let blogLinesSummary = ''
  try {
    const rag = await buildRAGContext('контент-план прогрев темы постов рилс сториз линии блога', projectId, 'post')
    const blogLineChunks = rag.projectContext.filter(c => c.material_type === 'blog_lines')
    const otherChunks = rag.projectContext.filter(c => c.material_type !== 'blog_lines')
    projectSummary = otherChunks.slice(0, 4).map(c => c.chunk_text).join('\n\n').slice(0, 800)
    blogLinesSummary = blogLineChunks.map(c => c.chunk_text).join('\n\n').slice(0, 1200)
  } catch { /* ignore */ }

  const daysText = days.map(d =>
    `День ${d.day} (${d.date}) — фаза: ${d.phase}, смысл: ${d.meaning || 'не задан'}`
  ).join('\n')

  const prompt = `Составь план контента на неделю для блогера. Верни ТОЛЬКО JSON, без markdown, без пояснений.

ПРОЕКТ: ${project.name}
НИША: ${project.niche || 'не указана'}
${project.description ? `ОПИСАНИЕ: ${project.description}` : ''}
${projectSummary ? `МАТЕРИАЛЫ ПРОЕКТА:\n${projectSummary}` : ''}
${blogLinesSummary ? `\nЛИНИИ БЛОГА (личные истории и нарративы блогера — вплетай их в темы постов):\n${blogLinesSummary}\n\nВАЖНО: не менее 2 единиц контента в неделю должны опираться на личные линии блога — это делает контент живым и нативным, не рекламным.` : ''}

ДНИ НЕДЕЛИ:
${daysText}

ЗАДАЧА: для каждого дня пропиши конкретную тему каждой единицы контента (1–2 предложения с реальными деталями, не общие слова). Темы должны логично раскрывать фазу прогрева и при этом звучать живо, не как реклама.

JSON формат (строго):
{"days":[{"day":1,"brief":{"post":"конкретная тема поста","stories":"конкретная тема сториз","reels":"конкретная тема рилса"}}]}`

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('AI не вернул JSON')

    const data = JSON.parse(jsonMatch[0])
    return NextResponse.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ошибка AI'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
