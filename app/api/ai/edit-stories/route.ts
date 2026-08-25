import { NextResponse } from 'next/server'
import { captureException } from '@/lib/sentry'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rateLimit'
import { requirePaidAccess } from '@/lib/billing/access'
import { anthropic, MODEL, AI_BUSY_MESSAGE } from '@/lib/ai/client'
import { getAiTells, detectTextLanguage, VISUAL_RULES } from '@/lib/ai/prompts/content-brain'
import { requireProjectAccess } from '@/lib/projects/access'

// Chat/voice edits to an already-designed stories series («на третьей сторис
// поменяй…», owner request). Takes the current frames + a free-form instruction
// (often dictated), returns the FULL updated frames array — only what was asked
// changes, everything else returns byte-identical.
export const maxDuration = 60

interface Frame { headline?: string; body?: string; cta?: string; position?: string; plate?: boolean }

function toArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await rateLimit(user.id, 'edit')
    if (!rl.allowed) return NextResponse.json({ error: rl.message, code: 'rate_limited' }, { status: 429 })

    const denied = await requirePaidAccess(user.id)
    if (denied) return denied

    const { projectId, frames, instruction } = (await request.json()) as { projectId?: string; frames?: Frame[]; instruction?: string }
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
    if (!frames || frames.length === 0) return NextResponse.json({ error: 'Нет кадров для правки' }, { status: 400 })
    if (!instruction || !instruction.trim()) return NextResponse.json({ error: 'Скажи, что поменять' }, { status: 400 })

    // AI generation costs real money and has no RLS-gated write here — check
    // editor+ explicitly.
    const access = await requireProjectAccess(supabase, projectId, user.id, 'editor')
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    const current = frames.map((f, i) =>
      `Кадр ${i + 1} (position: ${f.position || 'auto'}, подложка: ${f.plate === false ? 'без' : 'с подложкой'}):\n  headline: ${f.headline || ''}\n  body: ${f.body || ''}\n  cta: ${f.cta || ''}`
    ).join('\n')
    // Язык детектим по ЗНАЧЕНИЯМ кадров, без скелета «Кадр/headline:/position:»
    const valuesOnly = frames.map((f) => `${f.headline || ''} ${f.body || ''} ${f.cta || ''}`).join(' ')

    const prompt = `Ты — продюсер сторис. Блогер уже собрал серию сторис-кадров и просит внести ПРАВКУ (часто надиктована голосом, может ссылаться на номер кадра: «на третьей», «в последнем»).

ТЕКУЩИЕ КАДРЫ:
${current}

ПРАВКА ОТ БЛОГЕРА:
${instruction.slice(0, 1500)}

ПРАВИЛА:
- Меняй ТОЛЬКО то, о чём просят. Остальные кадры и поля верни ДОСЛОВНО как были (включая **акценты**).
- Количество кадров НЕ меняй, если прямо не попросили добавить/убрать кадр.
- ДОБАВИТЬ КАДР: если просят добавить кадр/сторис — верни НА ОДИН ЭЛЕМЕНТ БОЛЬШЕ: все прежние кадры ДОСЛОВНО (даже кадры с пустыми полями — верни их пустыми) + один НОВЫЙ кадр с текстом по просьбе (по умолчанию в конце списка). Это единственный случай, когда элементов больше, чем прислано.
- Можно менять: тексты, выделение **слов** акцентом, расположение текста (position: top | center | bottom), подложку (plate: "with" — текст на плашках, "without" — чистый текст без плашек).
- position указывай ТОЛЬКО для кадров, где просили её поменять; для остальных верни как было. plate указывай ТОЛЬКО если просили про подложку целиком — иначе оставь пустым.
- ПОДЛОЖКА ТОЧЕЧНО (важно): если просят выделить подложкой ТОЛЬКО конкретный фрагмент — предложение или слово («выдели подложкой только первое предложение», «подложку только под словом X», «оставь плашку только на хуке») — оберни РОВНО этот фрагмент в двойные квадратные скобки [[ ... ]] прямо внутри headline или body, а весь остальной текст оставь БЕЗ скобок. Тогда подложка ляжет только под обёрнутый фрагмент, остальное — чистым текстом на фото. Слова внутри скобок НЕ меняй (можно сохранить **акцент** внутри). В этом случае поле plate оставь пустым (скобки управляют подложкой). Если просят «убери выделение/плашки везде» — удали все [[ ]] и верни plate "without"; «подложку под весь текст» — удали все [[ ]] и верни plate "with".
- УБРАТЬ ПРИЗЫВ/КНОПКУ: если просят убрать призыв / CTA / «розовую кнопку-фразу» / «розовую подложку с последней фразы» на кадре — верни для ЭТОГО кадра поле cta ПУСТЫМ (пустая строка) и НЕ возвращай его обратно. Розовая «кнопка» внизу кадра = это cta.
- Если просят «короче/другими словами» — правь только указанный кадр (или все, если сказано «везде»).
- ЯЗЫК КАДРОВ НЕ МЕНЯЙ: правки пиши на языке самих кадров (английские кадры → английские правки), даже если просьба блогера на другом языке. Переводить кадры можно только если об этом прямо попросили.
${VISUAL_RULES}
${getAiTells(detectTextLanguage(valuesOnly))}

Верни ПОЛНЫЙ обновлённый список кадров через инструмент edit_stories (по одному элементу на каждый кадр, в том же порядке).`

    const tool = {
      name: 'edit_stories',
      description: 'Обновлённая раскадровка сторис',
      input_schema: {
        type: 'object' as const,
        properties: {
          stories: {
            type: 'array',
            items: { type: 'object', properties: { headline: { type: 'string' }, body: { type: 'string' }, cta: { type: 'string' }, position: { type: 'string', description: 'top | center | bottom' }, plate: { type: 'string', description: 'with | without — только если просили менять подложку, иначе пусто' } }, required: ['headline'] },
          },
        },
        required: ['stories'],
      },
    }

    // «добавь кадр/сторис» — модель обязана вернуть length+1: иначе клиент
    // видел «ничего не добавляет» (вторая половина жалобы Станислава).
    const addIntent = /добав|доба́в|add\b|ещё один|еще один/i.test(instruction)
    let raw: Array<Record<string, unknown>> = []
    for (let attempt = 0; attempt < 3; attempt++) {
      const reminder = attempt > 0 && addIntent
        ? `\n\n⚠️ ПОВТОР: блогер попросил ДОБАВИТЬ кадр. Верни РОВНО ${frames.length + 1} кадров: все ${frames.length} прежних ДОСЛОВНО без изменений + один новый в конце (или на месте, названном блогером).`
        : ''
      const res = await anthropic.messages.create({
        // 12000, не 2500 (Станислав, 25.08): серия из 13 кадров НЕ ВЛЕЗАЛА в
        // потолок — модель, сжимаясь под лимит, возвращала валидный JSON с
        // МЕНЬШИМ числом кадров, серия перезаписывалась урезанной, а файлы
        // выпавших кадров удалялись из хранилища («он 6 штук удалил»).
        model: MODEL, max_tokens: 12000, tools: [tool],
        tool_choice: { type: 'tool' as const, name: 'edit_stories' },
        messages: [{ role: 'user', content: prompt + reminder }],
      })
      // Обрезанный по потолку ответ = неполный список кадров: не принимаем.
      if (res.stop_reason === 'max_tokens') continue
      const block = res.content.find((b) => b.type === 'tool_use')
      const got = (block && block.type === 'tool_use') ? toArray((block.input as { stories?: unknown }).stories) as Array<Record<string, unknown>> : []
      if (got.length === 0) continue
      // Просили добавить, а кадров не прибавилось — пробуем ещё раз с напоминанием.
      if (addIntent && got.length <= frames.length && attempt < 2) { raw = []; continue }
      raw = got
      break
    }

    const s = (v: unknown) => String(v ?? '').trim()
    const out = raw
      .map((r, i) => {
        const p = s(r.position).toLowerCase()
        const plateRaw = s(r.plate).toLowerCase()
        const prev = frames[i] || {}
        return {
          headline: s(r.headline), body: s(r.body), cta: s(r.cta),
          position: (['top', 'center', 'bottom'].includes(p) ? p : prev.position) as 'top' | 'center' | 'bottom' | undefined,
          // plate present only when the user asked about it
          ...(plateRaw === 'with' ? { plate: true } : plateRaw === 'without' ? { plate: false } : {}),
        }
      })
      .filter((r) => r.headline || r.body)
    if (out.length === 0) return NextResponse.json({ error: 'Не удалось применить правку — попробуй сформулировать иначе' }, { status: 502 })

    // СЕРВЕРНЫЙ СТРАЖ ПОТЕРИ КАДРОВ: меньше кадров, чем прислали, без явной
    // просьбы удалить — не отдаём (клиент пересохранил бы серию урезанной и
    // хранилище удалило бы файлы выпавших кадров безвозвратно).
    const deleteIntent = /удали|убер|сотри|remove|delete/i.test(instruction)
    if (out.length < frames.length && !deleteIntent) {
      await captureException(new Error(`edit-stories вернул ${out.length} кадров вместо ${frames.length}`), { where: 'edit-stories count-guard', projectId })
      return NextResponse.json({ error: `Правка вернула ${out.length} кадров вместо ${frames.length} — ничего не меняю, чтобы не потерять кадры. Попробуй сформулировать точнее.` }, { status: 502 })
    }
    // Просили добавить кадр, а после ретраев его так и нет — честно говорим,
    // вместо тихой правки без добавления («ничего не добавляет»).
    if (addIntent && out.length <= frames.length) {
      return NextResponse.json({ error: 'Не получилось добавить кадр — попробуй ещё раз или напиши, ЧТО должно быть в новом кадре (например: «добавь кадр с призывом записаться»).' }, { status: 502 })
    }

    return NextResponse.json({ stories: out })
  } catch (e) {
    console.error('[edit-stories]', e instanceof Error ? e.message : e)
    await captureException(e, { where: 'edit-stories' })
    return NextResponse.json({ error: AI_BUSY_MESSAGE }, { status: 503 })
  }
}
