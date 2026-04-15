import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/client'
import { buildRAGContext } from '@/lib/ai/rag'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { projectId, instagramUsername, posts, bio, followersCount, avgLikes, avgComments } = body

    const { data: project } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single()

    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    // Get RAG context with methodology
    let ragContext = { systemKnowledge: [] as Array<{ chunk_text: string; metadata: Record<string, unknown> }>, projectContext: [] as Array<{ chunk_text: string; material_type: string; metadata: Record<string, unknown> }> }
    try {
      ragContext = await buildRAGContext('анализ аккаунта инстаграм контент стратегия прогрев', projectId)
    } catch {
      // continue without RAG
    }

    const methodology = ragContext.systemKnowledge.map(c => c.chunk_text).join('\n\n')

    const systemPrompt = `Ты — профессиональный AI-продюсер и стратег онлайн-запусков.
Ты анализируешь Instagram-аккаунт эксперта и даёшь конкретные рекомендации по улучшению контент-стратегии для подготовки к запуску продукта.

${methodology ? `МЕТОДОЛОГИЯ ПРОДЮСЕРА (Source of Truth):\n${methodology}\n` : ''}

ПРАВИЛА АНАЛИЗА:
1. Будь конкретным — называй реальные проблемы, не общие слова
2. Каждая рекомендация должна быть actionable — что именно делать
3. Оценивай по критериям: вовлечённость, прогревающий потенциал, экспертность, доверие
4. Выяви сильные стороны — от них отталкиваемся
5. Составь приоритетный план улучшений
6. Отвечай на русском языке`

    const postsText = posts && posts.length > 0
      ? posts.map((p: string, i: number) => `POST ${i + 1}:\n${p}`).join('\n\n---\n\n')
      : 'Посты не предоставлены'

    const userPrompt = `Проанализируй Instagram-аккаунт:

АККАУНТ: @${instagramUsername || 'не указан'}
НИША ПРОЕКТА: ${project.niche || 'не указана'}
ЭКСПЕРТ: ${project.name}

СТАТИСТИКА:
- Подписчики: ${followersCount || 'не указано'}
- Средние лайки: ${avgLikes || 'не указано'}
- Средние комментарии: ${avgComments || 'не указано'}

BIO / ОПИСАНИЕ ПРОФИЛЯ:
${bio || 'не указано'}

ПОСЛЕДНИЕ ПОСТЫ ЭКСПЕРТА:
${postsText}

Дай полный анализ в следующем формате:

## 📊 ОБЩАЯ ОЦЕНКА
Оцени аккаунт по шкале 1-10 по каждому критерию:
- Экспертность контента: X/10
- Вовлечённость аудитории: X/10
- Прогревающий потенциал: X/10
- Готовность к запуску: X/10

## 💪 СИЛЬНЫЕ СТОРОНЫ
(3-5 конкретных сильных стороны с примерами из постов)

## ⚠️ ГЛАВНЫЕ ПРОБЛЕМЫ
(3-5 конкретных проблем, которые мешают запуску)

## 🎯 ПЛАН УЛУЧШЕНИЙ НА 30 ДНЕЙ
Конкретные действия по неделям:
**Неделя 1:** ...
**Неделя 2:** ...
**Неделя 3:** ...
**Неделя 4:** ...

## 📝 РЕКОМЕНДАЦИИ ПО КОНТЕНТУ
Какие типы постов нужно добавить/убрать и почему

## 🚀 ГОТОВНОСТЬ К ЗАПУСКУ
Что нужно сделать перед началом прогрева, чтобы запуск прошёл максимально эффективно`

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const analysis = response.content[0].type === 'text' ? response.content[0].text : ''

    // Save analysis to project materials
    await supabase.from('project_materials').insert({
      project_id: projectId,
      material_type: 'audience_research',
      title: `Анализ Instagram @${instagramUsername} — ${new Date().toLocaleDateString('ru-RU')}`,
      raw_content: analysis,
      processing_status: 'ready',
    })

    return NextResponse.json({ analysis, instagramUsername })
  } catch (error) {
    console.error('Account analysis error:', error)
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 })
  }
}
