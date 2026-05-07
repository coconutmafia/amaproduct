import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/client'
import { buildRAGContext, type RAGContext } from '@/lib/ai/rag'
import { buildSystemPrompt, buildValidatorUserPrompt } from '@/lib/ai/prompts/system'
import { checkAndConsumeGeneration } from '@/lib/generations'
import { NextResponse } from 'next/server'
import type { WarmupPhase } from '@/types'

export const maxDuration = 60

export async function POST(request: Request) {
  // ── Pre-checks (auth, limits, project) before starting stream ──────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
  const { projectId, contentType, dayNumber, totalDays, phase, additionalInstructions, dayMeaning } = body

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('owner_id', user.id)
    .single()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // ── SSE stream — keeps connection alive through both Claude calls ───────────
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        // Step 1: Build RAG context
        send({ type: 'status', message: 'Анализирую материалы проекта...' })

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
          stories: 'серию сториз в формате JSON',
          live: 'сценарий прямого эфира (структура, тезисы, интерактив)',
          email: 'письмо для email-рассылки (тема, прехедер, тело письма)',
        }

        const phaseLabel: Record<string, string> = {
          awareness: 'осознание (знакомство с экспертом и проблемой)',
          trust: 'доверие (кейсы, авторитет, закулисье)',
          desire: 'желание (ценность продукта, трансформация)',
          close: 'закрытие (продажа, последний призыв)',
          niche: 'ПРОГРЕВ НА НИШУ — продаём идею категории, не себя и не продукт',
          expert: 'ПРОГРЕВ НА ЭКСПЕРТА — почему именно этот человек, его история и опыт',
          product: 'ПРОГРЕВ НА ПРОДУКТ — логика продукта, механизм, путь клиента',
          objections: 'ОТРАБОТКА ВОЗРАЖЕНИЙ И ДОЖИМЫ — снимаем последнее сопротивление',
          activation: 'активация аудитории',
        }

        const typeAngle: Record<string, string> = {
          post: `ФОРМАТ ПОСТА: Личная история или экспертная позиция. Начни с крючка (провокация, парадокс, цифра). Раскрой через конкретный пример/кейс из практики. Не пересказывай тему — покажи её через реальную ситуацию. Финал — чёткий CTA или вопрос.`,
          reels: `ФОРМАТ РИЛСА: Визуальный контраст или трансформация. Первые 3 секунды — сильный хук на экране. Показывай, не рассказывай. Используй сравнение ДО/ПОСЛЕ, или разрушение мифа через быстрые сцены. Никакого пересказа темы — только действие и эмоция.`,
          stories: `ФОРМАТ СТОРИЗ: Диалог с аудиторией. Используй вопрос/опрос/тест чтобы вовлечь. Каждая сториз — один простой тезис. Веди от проблемы к решению через интерактив. Последняя сториз — призыв к действию или переход. КОЛИЧЕСТВО СТОРИЗ: определяй сам в зависимости от объёма материала — от 5 до 14. Не обрезай историю ради лимита.`,
          carousel: `ФОРМАТ КАРУСЕЛИ: Образовательный разбор. Обложка = обещание ценности. Каждый слайд = 1 конкретная мысль (не абзац). Используй структуру: проблема → причина → решение → доказательство → CTA. Читатель должен хотеть листать дальше.`,
          live: `ФОРМАТ ЭФИРА: Живая беседа с элементами продажи. Структура: вовлечение → ценный контент → история → оффер. Включай интерактив каждые 10 минут. Разговорный стиль, отвечай на комментарии.`,
          email: `ФОРМАТ EMAIL: Личное письмо, не рекламная рассылка. Тема письма — интригует, не продаёт. Начни с истории или наблюдения. Один чёткий CTA в конце. Тон как будто пишешь другу.`,
        }

        const userPrompt = `Создай ${contentTypeLabel[contentType] || contentType} для блогера.

ПАРАМЕТРЫ:
- День прогрева: ${dayNumber} из ${totalDays || 45}
- Фаза: ${phaseLabel[phase] || phase}
- Блогер: ${project.name}
- Ниша: ${project.niche || 'не указана'}
${dayMeaning ? `- Смысл дня (из плана прогрева): ${dayMeaning}` : ''}
${typeAngle[contentType] ? `\n${typeAngle[contentType]}\n` : ''}
ВАЖНО: Если указан «Смысл дня» — контент должен раскрывать именно этот смысл, не отходи от него.

ОБЯЗАТЕЛЬНО: Используй конкретные детали из материалов проекта (кейсы, цифры, истории клиентов, TOV). Не пиши абстрактно — каждое утверждение должно быть конкретным.

${additionalInstructions ? `ДОПОЛНИТЕЛЬНО: ${additionalInstructions}` : ''}

${contentType === 'reels' ? `Верни JSON в формате:
{"reels":{"title":"...","hook_text":"...","total_duration":"30-60 сек","scenes":[{"scene":1,"timing":"0-3 сек","type":"hook","visual":{"description":"...","camera":"...","action":"..."},"text_overlay":"...","audio":{"speech":"...","tone":"..."},"transition":"cut"}],"hashtags":["#тег"],"description_text":"..."}}` : ''}

${contentType === 'carousel' ? `Верни JSON в формате:
{"carousel":{"total_slides":7,"cover":{"slide":1,"headline":"...","subheadline":"...","visual_description":"..."},"slides":[{"slide":2,"type":"problem","headline":"...","body":"...","emoji":""}],"last_slide":{"slide":7,"text":"...","action":"..."}}}` : ''}

${contentType === 'stories' ? `Определи количество сториз сам (5–14) исходя из объёма смысла и материала — не режь историю ради лимита.
Верни JSON в формате:
{"stories_series":{"total_stories":N,"goal":"...","stories":[{"story_number":1,"type":"opener","layout":"центр","visual":{"background":"...","main_element":"..."},"text":{"main_text":"..."},"interactive":{"type":"poll","question":"...","options":["Да","Нет"]},"cta":"..."}]}}
Где N — реальное количество сториз (от 5 до 14).` : ''}

${contentType === 'post' ? 'Напиши текст поста (без JSON). Начни с крючка. Включи переход к CTA. Добавь 5-7 хештегов в конце.' : ''}
${contentType === 'live' ? `Верни JSON в формате:
{"live":{"title":"...","duration_min":60,"goal":"...","structure":[{"block":"Вступление","duration_min":5,"content":"...","interactive":"..."},{"block":"Основная тема","duration_min":30,"content":"...","interactive":"..."},{"block":"Ответы на вопросы","duration_min":15,"content":"...","interactive":"..."},{"block":"Закрытие/оффер","duration_min":10,"content":"...","interactive":"..."}],"promo_text":"..."}}` : ''}
${contentType === 'email' ? `Напиши письмо для email-рассылки. Верни JSON в формате:
{"email":{"subject":"...","preheader":"...","body":"...","cta_text":"...","cta_url":"[ВСТАВИТЬ_ССЫЛКУ]","ps":"..."}}` : ''}`

        // ── Step 2: Generate ────────────────────────────────────────────────
        send({ type: 'status', message: 'Генерирую контент...' })

        // JSON-based types need more tokens than plain text posts
        const isJsonType = ['reels', 'carousel', 'stories', 'live', 'email'].includes(contentType)
        const genResponse = await anthropic.messages.create({
          model: MODEL,
          max_tokens: isJsonType ? 4096 : 2000,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        })

        const generatedText = genResponse.content[0].type === 'text' ? genResponse.content[0].text : ''

        // ── Step 3: Validate (only for text posts) ──────────────────────────
        // Validator uses the SAME system prompt = full context (TOV, methodology, style examples)
        let finalText = generatedText
        let wasValidated = false

        if (contentType === 'post' && generatedText.length > 100) {
          send({ type: 'status', message: 'Проверяю качество и улучшаю...' })

          const validatorStream = anthropic.messages.stream({
            model: MODEL,
            max_tokens: 1500,
            system: systemPrompt, // same full context — validator knows TOV, niche, methodology
            messages: [{ role: 'user', content: buildValidatorUserPrompt(generatedText) }],
          })

          finalText = ''
          for await (const chunk of validatorStream) {
            if (
              chunk.type === 'content_block_delta' &&
              chunk.delta.type === 'text_delta'
            ) {
              finalText += chunk.delta.text
              // Stream each text delta to client — user sees content being typed
              send({ type: 'text', delta: chunk.delta.text })
            }
          }

          wasValidated = finalText.length > 50
          if (!wasValidated) finalText = generatedText // fallback
        }

        // ── Step 4: Parse output ────────────────────────────────────────────
        let bodyText: string | null = null
        let structuredData: Record<string, Record<string, unknown>> | null = null
        let hashtags: string[] = []

        if (contentType === 'post') {
          bodyText = finalText
          const hashtagMatch = finalText.match(/#\w[\wА-Яа-яЁё]*/g)
          hashtags = hashtagMatch || []
        } else {
          try {
            const jsonMatch = generatedText.match(/\{[\s\S]*\}/)
            if (jsonMatch) {
              structuredData = JSON.parse(jsonMatch[0])
              if (structuredData?.reels?.hashtags) hashtags = structuredData.reels.hashtags as unknown as string[]
            } else {
              // AI returned plain text (not JSON) — save as body text
              bodyText = generatedText
            }
          } catch {
            // JSON parse failed — save raw text
            bodyText = generatedText
          }
          // Ensure at least body_text is set if structured_data is empty
          if (!structuredData && !bodyText) bodyText = generatedText
        }

        const title = contentType === 'post'
          ? finalText.split('\n')[0].substring(0, 80)
          : `${contentType} — День ${dayNumber}`

        // ── Step 5: Save to DB ──────────────────────────────────────────────
        const { count } = await supabase
          .from('content_items')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', projectId)
          .eq('content_type', contentType)
          .eq('day_number', dayNumber)

        const versionNumber = (count || 0) + 1

        // Map any phase name → DB-allowed value
        // DB constraint only allows: awareness, trust, desire, close, activation
        const VALID_DB_PHASES = new Set(['awareness', 'trust', 'desire', 'close', 'activation'])
        const PHASE_DB_MAP: Record<string, string> = {
          niche: 'awareness',
          expert: 'trust',
          product: 'desire',
          objections: 'close',
          phase_1: 'awareness',
          phase_2: 'trust',
          phase_3: 'desire',
          phase_4: 'close',
        }
        const dbPhase = (
          PHASE_DB_MAP[phase] ?? (VALID_DB_PHASES.has(phase) ? phase : 'awareness')
        ) as WarmupPhase

        const { data: contentItem, error } = await supabase
          .from('content_items')
          .insert({
            project_id: projectId,
            content_type: contentType,
            title,
            day_number: dayNumber,
            warmup_phase: dbPhase,
            body_text: bodyText,
            structured_data: structuredData,
            hashtags: hashtags.length > 0 ? hashtags : null,
            generation_prompt: userPrompt,
            version_number: versionNumber,
          })
          .select()
          .single()

        if (error) throw new Error(error.message || 'DB insert failed')

        send({ type: 'done', item: contentItem, structuredData, was_validated: wasValidated })
        controller.close()
      } catch (err) {
        const msg = err instanceof Error ? err.message : (typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: unknown }).message) : 'Generation failed')
        console.error('Generate SSE error:', err)
        send({ type: 'error', message: msg })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
