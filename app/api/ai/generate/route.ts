import { createClient } from '@/lib/supabase/server'
import { captureException } from '@/lib/sentry'
import { anthropic, MODEL, buildCachedSystem } from '@/lib/ai/client'
import { buildRAGContext, type RAGContext } from '@/lib/ai/rag'
import { buildSystemPrompt, buildValidatorUserPrompt } from '@/lib/ai/prompts/system'
import { getSchemaForPhase, getHookEngine, getEmotionalMechanics, getCTAEngine, getViralReelsFramework, resolveContentLanguage } from '@/lib/ai/prompts/content-brain'
import { gateContentUnit, refundGeneration } from '@/lib/generations'
import { requirePaidAccess } from '@/lib/billing/access'
import { contentItemToText } from '@/lib/contentToText'
import { NextResponse } from 'next/server'
import type { WarmupPhase } from '@/types'
import { rateLimit } from '@/lib/rateLimit'
import { requireProjectAccess } from '@/lib/projects/access'

// Vercel Pro allows up to 300s. This route runs RAG + a blocking generation +
// (for posts) a validator pass. The old 60s cap could kill the function mid-call
// → nothing saved AND the consumed generation never refunded (same class of bug
// fixed earlier for /api/ai/chat). 300s gives the full work room to finish.
export const maxDuration = 300

export async function POST(request: Request) {
  // ── Pre-checks (auth, limits, project) before starting stream ──────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(user.id, 'generate')
  if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

  const denied = await requirePaidAccess(user.id)
  if (denied) return denied

  // Через gateContentUnit, а не checkAndConsumeGeneration напрямую: последний не
  // знает про BILLING_ENFORCED и отдавал жёсткий 429 даже когда гейт выключен
  // (нарушая инвариант «до запуска никого не блокируем»), плюс не проверял
  // entitlement. Код 402 — тот же, что ловят остальные клиенты.
  const gate = await gateContentUnit(user.id)
  if (gate.blocked) {
    const code = gate.reason === 'not_entitled' ? 'payment_required' : 'limit_reached'
    return NextResponse.json(
      { error: code, code, monthlyUsed: gate.monthlyUsed, monthlyLimit: gate.monthlyLimit },
      { status: 402 },
    )
  }

  const body = await request.json()
  const { projectId, contentType, dayNumber, totalDays, phase, additionalInstructions, dayMeaning } = body

  // AI generation costs real money and has no RLS-gated write here — check
  // editor+ explicitly.
  const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
  if (!access.ok) {
    await refundGeneration(user.id)
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()

  if (!project) {
    await refundGeneration(user.id) // nothing was generated — give the quota back
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

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

        // Язык контента: примеры-значения в JSON-шаблонах ниже модель копирует
        // ДОСЛОВНО в вывод («30-60 сек», «Вариант А») — для en/es/de блогов они
        // обязаны быть на языке блога, иначе в контент просачивается русский.
        const contentLang = resolveContentLanguage(project)
        const JEX = ({
          en: { dur: '30-60 sec', timing: '0-3 sec', bg: 'color or photo', main: 'the main thing in frame', headline: '1-4 words', subtext: 'one short phrase or empty', voice: 'what the author says out loud in this story (1-2 sentences)', options: '"Option A","Option B"', transition: 'next step', day: 'Day', opening: 'Opening', mainTopic: 'Main topic', qa: 'Q&A', closing: 'Closing / offer', link: '[INSERT_LINK]' },
          es: { dur: '30-60 seg', timing: '0-3 seg', bg: 'color o foto', main: 'lo principal en el encuadre', headline: '1-4 palabras', subtext: 'una frase corta o vacío', voice: 'lo que la autora dice en voz alta en esta historia (1-2 frases)', options: '"Opción A","Opción B"', transition: 'siguiente paso', day: 'Día', opening: 'Apertura', mainTopic: 'Tema principal', qa: 'Preguntas y respuestas', closing: 'Cierre / oferta', link: '[INSERTAR_ENLACE]' },
          de: { dur: '30-60 Sek', timing: '0-3 Sek', bg: 'Farbe oder Foto', main: 'das Wichtigste im Bild', headline: '1-4 Wörter', subtext: 'eine kurze Zeile oder leer', voice: 'was die Autorin in dieser Story laut sagt (1-2 Sätze)', options: '"Option A","Option B"', transition: 'nächster Schritt', day: 'Tag', opening: 'Einstieg', mainTopic: 'Hauptthema', qa: 'Fragen und Antworten', closing: 'Abschluss / Angebot', link: '[LINK_EINFÜGEN]' },
        } as const)[contentLang as 'en' | 'es' | 'de'] ?? null

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
          stories: `ФОРМАТ СТОРИЗ — КРИТИЧЕСКИЕ ПРАВИЛА:
❌ СТОРИЗ — НЕ ПОСТ. Люди не читают длинный текст в сторис. Они смотрят.
✅ Текст на экране: максимум 1–4 слова крупно (headline) + 1 короткая фраза (subtext) — или вообще без текста.
✅ Смысл передаётся через визуал, голос автора, интерактив — не через текст на экране.
✅ Каждая сториз = одно действие: вопрос / факт / реакция / голосование / переход.
✅ Диалог строится через интерактив (опросы, вопросы, тесты) — не через текст.`,
          carousel: `ФОРМАТ КАРУСЕЛИ: Образовательный разбор. Обложка = обещание ценности. Каждый слайд = 1 конкретная мысль (не абзац). Используй структуру: проблема → причина → решение → доказательство → CTA. Читатель должен хотеть листать дальше.`,
          live: `ФОРМАТ ЭФИРА: Живая беседа с элементами продажи. Структура: вовлечение → ценный контент → история → оффер. Включай интерактив каждые 10 минут. Разговорный стиль, отвечай на комментарии.`,
          email: `ФОРМАТ EMAIL: Личное письмо, не рекламная рассылка. Тема письма — интригует, не продаёт. Начни с истории или наблюдения. Один чёткий CTA в конце. Тон как будто пишешь другу.`,
        }

        // Normalize phase → content-brain keys. Warmup plans may store generic
        // phase_1..4; map them to the semantic keys that have dedicated schemas /
        // emotional arcs / CTA (niche → expert → product → objections), so a raw
        // "phase_1" never reaches the model or falls back to a weaker schema.
        const PHASE_CONTENT_MAP: Record<string, string> = {
          phase_1: 'niche', phase_2: 'expert', phase_3: 'product', phase_4: 'objections',
        }
        const contentPhase = PHASE_CONTENT_MAP[phase as string] ?? phase

        // ── Content Brain layers (phase + type specific) ─────────────────
        const contentSchema = getSchemaForPhase(contentPhase, contentType)
        const hookEngine    = getHookEngine(contentType)
        const emotionalArc  = getEmotionalMechanics(contentPhase)
        const ctaGuidance   = getCTAEngine(contentPhase)

        const userPrompt = `Создай ${contentTypeLabel[contentType] || contentType} для блогера.

ПАРАМЕТРЫ:
- День прогрева: ${dayNumber} из ${totalDays || 45}
- Фаза: ${phaseLabel[contentPhase] || phaseLabel[phase] || contentPhase}
- Блогер: ${project.name}
- Ниша: ${project.niche || 'не указана'}
${dayMeaning ? `- Смысл дня (из плана прогрева): ${dayMeaning}` : ''}
${typeAngle[contentType] ? `\n${typeAngle[contentType]}\n` : ''}
ВАЖНО: Если указан «Смысл дня» — контент должен раскрывать именно этот смысл, не отходи от него.

ОБЯЗАТЕЛЬНО: Используй конкретные детали из материалов проекта (кейсы, цифры, истории клиентов, TOV). Не пиши абстрактно — каждое утверждение должно быть конкретным.

─── ПСИХОЛОГИЯ ЭТОГО КОНТЕНТА ───────────────────────────────
${emotionalArc}

${contentSchema}

${hookEngine}

${ctaGuidance}
─────────────────────────────────────────────────────────────
${contentType === 'reels' ? `\n${getViralReelsFramework()}\n` : ''}
${additionalInstructions ? `ДОПОЛНИТЕЛЬНО: ${additionalInstructions}` : ''}

${contentType === 'reels' ? `Верни JSON в формате:
{"reels":{"title":"...","hook_text":"...","total_duration":"${JEX ? JEX.dur : '30-60 сек'}","scenes":[{"scene":1,"timing":"${JEX ? JEX.timing : '0-3 сек'}","type":"hook","visual":{"description":"...","camera":"...","action":"..."},"text_overlay":"...","audio":{"speech":"...","tone":"..."},"transition":"cut"}],"description_text":"..."}}
ВАЖНО: НЕ добавляй хэштеги — ни в description_text, ни отдельным полем. У этого блогера хэштегов нет.` : ''}

${contentType === 'carousel' ? `Верни JSON в формате:
{"carousel":{"total_slides":7,"cover":{"slide":1,"headline":"...","subheadline":"...","visual_description":"..."},"slides":[{"slide":2,"type":"problem","headline":"...","body":"...","emoji":""}],"last_slide":{"slide":7,"text":"...","action":"..."}}}` : ''}

${contentType === 'stories' ? `ПРАВИЛО ТЕКСТА: поля headline и subtext — это то, что видит зритель на экране.
headline = 1–4 слова (крупный акцент). subtext = 1 короткая фраза или "" если не нужна.
НЕ пиши в эти поля длинные предложения — только то, что помещается на экран сторис.
Смысл и детали — в поле "voiceover" (что автор говорит голосом) и "visual" (что показывает).

Верни JSON (5–10 сторис, не больше):
{"stories_series":{"total_stories":N,"goal":"...","stories":[{"story_number":1,"type":"opener","visual":{"background":"${JEX ? JEX.bg : 'цвет или фото'}","main_element":"${JEX ? JEX.main : 'что главное в кадре'}"},"text":{"headline":"${JEX ? JEX.headline : '1-4 слова'}","subtext":"${JEX ? JEX.subtext : '1 фраза или пусто'}"},"voiceover":"${JEX ? JEX.voice : 'что автор говорит голосом в этой сторис (1-2 предложения)'}","interactive":{"type":"poll","question":"...","options":[${JEX ? JEX.options : '"Вариант А","Вариант Б"'}]},"transition":"${JEX ? JEX.transition : 'следующий шаг'}"}]}}` : ''}

${contentType !== 'post' ? (JEX
  ? `⚠️ VOICE IN ALL TEXT FIELDS OF THE JSON (hook, headline, body, description_text, voiceover, speech, subject etc.): this blogger's living language, in the blog's language. NO em dashes. NO staccato noun fragments ("Sea. Sun. A new life.") or "Not A. Not B. Just C." telegraph — only connected phrases. NO negative parallelism ("It's not just X, it's Y") or template lead-ins ("Here's the thing"). No corporate speak, no empty promises — concrete details only. Followers read these fields; post rules apply.`
  : `⚠️ ГОЛОС ВО ВСЕХ ТЕКСТОВЫХ ПОЛЯХ JSON (hook, headline, body, description_text, voiceover, speech, subject и т.д.): живой язык этого блогера. БЕЗ тире «—». БЕЗ существительных через точку («Море. Солнце. Новая жизнь.») и телеграфных обрывков («Не А. Не Б. А В.») — только связные фразы. БЕЗ шаблонных подводок «И знаешь(те), что самое…?». Без канцелярита и пустых обещаний («скажу конкретно», «разбираю внутри») — только конкретика. Эти поля читает подписчик, правила как для постов.`) : ''}
${contentType === 'post' ? 'Напиши текст поста (без JSON). Начни с крючка. Включи переход к CTA. БЕЗ хэштегов.' : ''}
${contentType === 'live' ? `Верни JSON в формате:
{"live":{"title":"...","duration_min":60,"goal":"...","structure":[{"block":"${JEX ? JEX.opening : 'Вступление'}","duration_min":5,"content":"...","interactive":"..."},{"block":"${JEX ? JEX.mainTopic : 'Основная тема'}","duration_min":30,"content":"...","interactive":"..."},{"block":"${JEX ? JEX.qa : 'Ответы на вопросы'}","duration_min":15,"content":"...","interactive":"..."},{"block":"${JEX ? JEX.closing : 'Закрытие/оффер'}","duration_min":10,"content":"...","interactive":"..."}],"promo_text":"..."}}` : ''}
${contentType === 'email' ? `Напиши письмо для email-рассылки. Верни JSON в формате:
{"email":{"subject":"...","preheader":"...","body":"...","cta_text":"...","cta_url":"${JEX ? JEX.link : '[ВСТАВИТЬ_ССЫЛКУ]'}","ps":"..."}}` : ''}`

        // ── Step 2: Generate ────────────────────────────────────────────────
        send({ type: 'status', message: 'Генерирую контент...' })

        // JSON-based types need more tokens than plain text posts
        const isJsonType = ['reels', 'carousel', 'stories', 'live', 'email'].includes(contentType)
        const genResponse = await anthropic.messages.create({
          model: MODEL,
          // JSON content (reels raskadrovka, 7-slide carousels) can be long — a
          // low ceiling truncates the JSON, JSON.parse fails, and we'd save a
          // broken blob as plain text. Give it real headroom; posts stay modest.
          max_tokens: isJsonType ? 8192 : 2000,
          system: buildCachedSystem(systemPrompt),
          messages: [{ role: 'user', content: userPrompt }],
        })

        // Truncated by the token ceiling → JSON is incomplete and unparseable.
        // Fail loudly + refund rather than save a garbled item.
        if (isJsonType && genResponse.stop_reason === 'max_tokens') {
          await refundGeneration(user.id)
          send({ type: 'error', message: 'Контент получился слишком длинным и обрезался. Нажми «Создать» ещё раз — обычно выходит короче.' })
          controller.close()
          return
        }

        // Scan ALL text blocks — a leading thinking block would make
        // content[0] non-text and silently produce empty content.
        const generatedText = genResponse.content.map(b => (b.type === 'text' ? b.text : '')).join('\n')

        // ── Step 3: Validate (only for text posts) ──────────────────────────
        // Validator uses the SAME system prompt = full context (TOV, methodology, style examples)
        let finalText = generatedText
        let wasValidated = false

        if (contentType === 'post' && generatedText.length > 100) {
          send({ type: 'status', message: 'Проверяю качество и улучшаю...' })

          const validatorStream = anthropic.messages.stream({
            model: MODEL,
            max_tokens: 1500,
            system: buildCachedSystem(systemPrompt), // same full context — validator knows TOV, niche, methodology
            messages: [{ role: 'user', content: buildValidatorUserPrompt(generatedText, contentLang) }],
          })

          finalText = ''
          try {
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
            // Only trust the validated text if the validator finished CLEANLY.
            // A truncated (max_tokens) or aborted validator would otherwise
            // overwrite the good generated post with a half-finished one.
            const vFinal = await validatorStream.finalMessage()
            wasValidated = vFinal.stop_reason === 'end_turn' && finalText.length > 50
          } catch (e) {
            console.error('[generate] validator stream failed:', e)
            wasValidated = false
          }
          if (!wasValidated) finalText = generatedText // fallback to unvalidated
        }

        // ── Step 4: Parse output ────────────────────────────────────────────
        let bodyText: string | null = null
        let structuredData: Record<string, Record<string, unknown>> | null = null
        let hashtags: string[] = []

        if (contentType === 'post') {
          // Strip any hashtags AI may have slipped in — the user's content
          // style is no-hashtags. Remove tags + clean up double spaces /
          // trailing whitespace they leave behind.
          bodyText = finalText.replace(/#[\wА-Яа-яЁё]+/g, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
          hashtags = []
        } else {
          try {
            const jsonMatch = generatedText.match(/\{[\s\S]*\}/)
            if (jsonMatch) {
              structuredData = JSON.parse(jsonMatch[0])
              // No hashtags anywhere — the user's style has none. Drop the
              // hashtags array and strip any # tags the AI put in the
              // description_text / caption fields.
              for (const fmt of Object.values(structuredData ?? {})) {
                if (fmt && typeof fmt === 'object') {
                  const f = fmt as Record<string, unknown>
                  delete f.hashtags
                  if (typeof f.description_text === 'string') {
                    f.description_text = f.description_text.replace(/#[\wА-Яа-яЁё]+/g, '').replace(/[ \t]{2,}/g, ' ').trim()
                  }
                }
              }
            } else {
              // AI returned plain text (not JSON) — save as body text
              bodyText = generatedText.replace(/#[\wА-Яа-яЁё]+/g, '').replace(/[ \t]{2,}/g, ' ').trim()
            }
          } catch {
            // JSON parse failed — save raw text
            bodyText = generatedText.replace(/#[\wА-Яа-яЁё]+/g, '').replace(/[ \t]{2,}/g, ' ').trim()
          }
          // Ensure at least body_text is set if structured_data is empty
          if (!structuredData && !bodyText) bodyText = generatedText
          // Always keep a CLEAN readable text version alongside structured_data,
          // so the editor / library / export never surface raw JSON (the user
          // was seeing the streamed JSON as "код"). structured_data still drives
          // the pretty StructuredContentView.
          if (structuredData && (!bodyText || !bodyText.trim())) {
            const flat = contentItemToText({ structured_data: structuredData })
            if (flat.trim()) bodyText = flat
          }
          hashtags = [] // never store hashtags
        }

        const title = contentType === 'post'
          ? finalText.split('\n')[0].substring(0, 80)
          : `${contentType} — ${JEX ? JEX.day : 'День'} ${dayNumber}`

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
        console.error('Generate SSE error:', err)
        // Сырец — в телеметрию (окно сбоев видно в /admin/errors), клиенту —
        // честный русский текст без хвостов провайдера.
        await captureException(err, { where: 'generate SSE' })
        // Generation failed — refund the consumed quota so the user isn't charged
        await refundGeneration(user.id)
        send({ type: 'error', message: 'Генерация сейчас перегружена или временно недоступна — попробуй через минуту-две. Единица контента возвращена.' })
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
