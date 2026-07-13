import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL, buildCachedSystem } from '@/lib/ai/client'
import { buildRAGContext, type RAGContext } from '@/lib/ai/rag'
import { buildSystemPrompt } from '@/lib/ai/prompts/system'
import { AI_TELLS_TO_AVOID } from '@/lib/ai/prompts/content-brain'
import { cleanMarkdown } from '@/lib/cleanText'
import { requireProjectAccess } from '@/lib/projects/access'
import { rateLimit } from '@/lib/rateLimit'

export const maxDuration = 120

// Regenerate ONLY the fragment the user highlighted inside a chat answer, keeping
// it fitting seamlessly in place (same role/meaning, author's voice, fresh
// wording — or a specific ask). The client splices the returned fragment back
// into the full text and shows the whole updated version.
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await rateLimit(user.id, 'chat')
    if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

    const { projectId, fullText, fragment, instruction } = (await request.json()) as {
      projectId?: string
      fullText?: string
      fragment?: string
      instruction?: string
    }

    const full = (fullText ?? '').trim()
    const frag = (fragment ?? '').trim()
    if (!frag) return NextResponse.json({ error: 'Пустой фрагмент' }, { status: 400 })
    if (!full || !full.includes(frag)) {
      return NextResponse.json({ error: 'Фрагмент не найден в тексте' }, { status: 400 })
    }

    // ── Build the voice/context system prompt ────────────────────────────────
    let voiceBlock = ''
    if (projectId) {
      // AI generation costs money and writes nothing RLS-gated here — check editor+.
      const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
      if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

      const { data: project } = await supabase.from('projects').select('*').eq('id', projectId).single()
      if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

      let ragContext: RAGContext = { systemKnowledge: [], projectContext: [], styleExamples: [] }
      try {
        ragContext = await buildRAGContext(frag, projectId)
      } catch { /* continue without RAG */ }
      voiceBlock = buildSystemPrompt(ragContext, project)
    } else {
      voiceBlock = `Ты — сильный копирайтер по контенту для соцсетей. Пиши живым человеческим языком, без воды и канцелярита, без хэштегов и markdown.\n\n${AI_TELLS_TO_AVOID}`
    }

    const systemPrompt = `${voiceBlock}

═══════════════════════════════════════
РЕЖИМ: ПЕРЕГЕНЕРАЦИЯ ВЫДЕЛЕННОГО ФРАГМЕНТА
═══════════════════════════════════════
Пользователь читает готовый текст и выделил в нём ОДИН фрагмент, который хочет переписать. Остальной текст трогать НЕЛЬЗЯ.

ПОЛНЫЙ ТЕКСТ (только для контекста, не переписывай его целиком):
«««
${full}
»»»

ВЫДЕЛЕННЫЙ ФРАГМЕНТ (перепиши ТОЛЬКО его):
«««
${frag}
»»»
${instruction && instruction.trim() ? `\nПОЖЕЛАНИЕ ПОЛЬЗОВАТЕЛЯ К ЭТОМУ ФРАГМЕНТУ: ${instruction.trim()}` : ''}

ЗАДАЧА:
- Перепиши ТОЛЬКО выделенный фрагмент так, чтобы он органично встал на своё место в полном тексте: та же смысловая роль, голос автора, но свежая формулировка (или по пожеланию выше).
- Сохрани стыки с окружением: если фрагмент — середина предложения, не начинай с заглавной буквы и не добавляй точку в конце; если это отдельный абзац/сцена — сохрани его структуру.
- Длина примерно как у оригинала (не раздувай).
- НИКАКОГО markdown, кавычек-обёрток и пояснений.
- Верни результат СТРОГО так (одна обёртка, внутри — только новый текст фрагмента):
<fragment>новый текст фрагмента</fragment>`

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: buildCachedSystem(systemPrompt),
      messages: [{ role: 'user', content: 'Перепиши выделенный фрагмент.' }],
    })

    const raw = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('')

    const match = raw.match(/<fragment>([\s\S]*?)<\/fragment>/)
    const newFragment = cleanMarkdown((match ? match[1] : raw).trim())
    if (!newFragment) return NextResponse.json({ error: 'Пустой ответ модели' }, { status: 502 })

    return NextResponse.json({ fragment: newFragment })
  } catch (error) {
    console.error('regenerate-fragment error:', error)
    const msg = error instanceof Error ? error.message : 'Ошибка сервера'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
