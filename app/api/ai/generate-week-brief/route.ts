import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/client'
import { buildRAGContext } from '@/lib/ai/rag'
import { NextResponse } from 'next/server'

export const maxDuration = 60

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

  // Get RAG context
  let ragSummary = ''
  try {
    const rag = await buildRAGContext('контент-план прогрев темы постов рилс сториз', projectId, 'post')
    ragSummary = rag.projectContext.slice(0, 3).map(c => c.chunk_text).join('\n\n')
  } catch { /* ignore */ }

  const daysText = days.map(d =>
    `День ${d.day} (${d.date}) — фаза: ${d.phase}, смысл: ${d.meaning || 'не задан'}`
  ).join('\n')

  const prompt = `Ты — эксперт по контент-маркетингу. Составь конкретный план контента на неделю для блогера.

ПРОЕКТ: ${project.name}
НИША: ${project.niche || 'не указана'}
ОПИСАНИЕ: ${project.description || ''}

${ragSummary ? `МАТЕРИАЛЫ ИЗ БАЗЫ ЗНАНИЙ:\n${ragSummary}\n` : ''}

ДНИ ПРОГРЕВА НА ЭТУ НЕДЕЛЮ:
${daysText}

Для каждого дня предложи КОНКРЕТНЫЕ темы для контента. Каждая тема — одно-два предложения с конкретикой (не «расскажи о продукте», а конкретный угол подачи, факт, история).

Верни строго JSON без markdown:
{
  "days": [
    {
      "day": 1,
      "brief": {
        "post": "конкретная тема поста",
        "stories": "конкретная тема сториз",
        "reels": "конкретная тема рилса"
      }
    }
  ]
}`

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
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
