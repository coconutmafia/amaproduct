import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/client'
import { buildRAGContext, type RAGContext } from '@/lib/ai/rag'
import { buildSystemPrompt, buildValidatorPrompt } from '@/lib/ai/prompts/system'
import { checkAndConsumeGeneration } from '@/lib/generations'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Check generation limit before doing any work
    const genCheck = await checkAndConsumeGeneration(user.id)
    if (!genCheck.allowed) {
      return NextResponse.json({
        error: 'Лимит запросов исчерпан',
        code: 'GENERATION_LIMIT',
        remaining: 0,
        hint: 'Пригласи друга (+10 бонусных запросов) или перейди на платный тариф',
      }, { status: 429 })
    }

    const body = await request.json()
    const { projectId, contentType, dayNumber, totalDays, phase, additionalInstructions } = body

    const { data: project } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single()

    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    // Build RAG context — now passes contentType for targeted style example retrieval
    let ragContext: RAGContext = { systemKnowledge: [], projectContext: [], styleExamples: [] }
    try {
      ragContext = await buildRAGContext(
        `${contentType} прогрев день ${dayNumber} фаза ${phase}`,
        projectId,
        contentType
      )
    } catch {
      // RAG unavailable — continue without it
    }

    const systemPrompt = buildSystemPrompt(ragContext, project)

    const contentTypeLabel: Record<string, string> = {
      post: 'пост для Instagram/VK',
      carousel: 'пост-карусель',
      reels: 'сценарий рилса с раскадровкой в формате JSON',
      stories: 'серию сториз (5 штук) в формате JSON',
    }

    const phaseLabel: Record<string, string> = {
      awareness: 'осознание (знакомство с экспертом и проблемой)',
      trust: 'доверие (кейсы, авторитет, закулисье)',
      desire: 'желание (ценность продукта, трансформация)',
      close: 'закрытие (продажа, последний призыв)',
    }

    const userPrompt = `Создай ${contentTypeLabel[contentType] || contentType} для блогера.

ПАРАМЕТРЫ:
- День прогрева: ${dayNumber} из ${totalDays || 45}
- Фаза: ${phaseLabel[phase] || phase}
- Блогер: ${project.name}
- Ниша: ${project.niche || 'не указана'}

${additionalInstructions ? `ДОПОЛНИТЕЛЬНО: ${additionalInstructions}` : ''}

${contentType === 'reels' ? `Верни JSON в формате:
{"reels":{"title":"...","hook_text":"...","total_duration":"30-60 сек","scenes":[{"scene":1,"timing":"0-3 сек","type":"hook","visual":{"description":"...","camera":"...","action":"..."},"text_overlay":"...","audio":{"speech":"...","tone":"..."},"transition":"cut"}],"hashtags":["#тег"],"description_text":"..."}}` : ''}

${contentType === 'carousel' ? `Верни JSON в формате:
{"carousel":{"total_slides":7,"cover":{"slide":1,"headline":"...","subheadline":"...","visual_description":"..."},"slides":[{"slide":2,"type":"problem","headline":"...","body":"...","emoji":""}],"last_slide":{"slide":7,"text":"...","action":"..."}}}` : ''}

${contentType === 'stories' ? `Верни JSON в формате:
{"stories_series":{"total_stories":5,"goal":"...","stories":[{"story_number":1,"type":"opener","layout":"центр","visual":{"background":"...","main_element":"..."},"text":{"main_text":"..."},"interactive":{"type":"poll","question":"...","options":["Да","Нет"]},"cta":"..."}]}}` : ''}

${contentType === 'post' ? 'Напиши текст поста (без JSON). Начни с крючка. Включи переход к CTA. Добавь 5-7 хештегов в конце.' : ''}`

    // === STEP 1: Initial generation ===
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    let rawText = response.content[0].type === 'text' ? response.content[0].text : ''

    // === STEP 2: Валидатор Смыслов (Self-Reflection) ===
    // Only for text posts — structured JSON content (reels/carousel/stories) skips validation
    if (contentType === 'post' && rawText.length > 100) {
      try {
        const systemKnowledgeText = ragContext.systemKnowledge
          .map((c) => c.chunk_text)
          .join('\n\n')

        const validationResponse = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: buildValidatorPrompt(rawText, systemKnowledgeText),
          }],
        })

        const validatedText = validationResponse.content[0].type === 'text'
          ? validationResponse.content[0].text
          : ''

        if (validatedText.length > 50) {
          rawText = validatedText
        }
      } catch {
        // Validator unavailable — use original text
      }
    }

    // === STEP 3: Parse output ===
    let bodyText: string | null = null
    let structuredData: Record<string, Record<string, unknown>> | null = null
    let hashtags: string[] = []

    if (contentType === 'post') {
      bodyText = rawText
      const hashtagMatch = rawText.match(/#\w[\wА-Яа-яЁё]*/g)
      hashtags = hashtagMatch || []
    } else {
      try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          structuredData = JSON.parse(jsonMatch[0])
          if (structuredData?.reels?.hashtags) hashtags = structuredData.reels.hashtags as unknown as string[]
        }
      } catch {
        bodyText = rawText
      }
    }

    const title = contentType === 'post'
      ? rawText.split('\n')[0].substring(0, 80)
      : `${contentType} — День ${dayNumber}`

    // === STEP 4: Check existing version count for this project+type+day ===
    const { count } = await supabase
      .from('content_items')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('content_type', contentType)
      .eq('day_number', dayNumber)

    const versionNumber = (count || 0) + 1

    const { data: contentItem, error } = await supabase
      .from('content_items')
      .insert({
        project_id: projectId,
        content_type: contentType,
        title,
        day_number: dayNumber,
        warmup_phase: phase,
        body_text: bodyText,
        structured_data: structuredData,
        hashtags: hashtags.length > 0 ? hashtags : null,
        generation_prompt: userPrompt,
        version_number: versionNumber,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({
      item: contentItem,
      structuredData,
      was_validated: contentType === 'post',
    })
  } catch (error) {
    console.error('Generate error:', error)
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg || 'Generation failed' }, { status: 500 })
  }
}
