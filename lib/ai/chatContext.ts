// Сборка контекста чата — ОДНА для боевого ответа и для оценки «≈ N ед.»
// (05.09, честные единицы): оценка до отправки обязана считать те же самые
// system-блоки и сообщения, что уйдут в модель, иначе цифра врёт.
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildRAGContext, type RAGContext } from '@/lib/ai/rag'
import { buildSystemPrompt } from '@/lib/ai/prompts/system'
import { AI_TELLS_TO_AVOID, resolveContentLanguage } from '@/lib/ai/prompts/content-brain'
import type { Project } from '@/types'

export type ChatMsg = { role: 'user' | 'assistant'; content: string; images?: string[] }
type Db = SupabaseClient

const SAVED_TYPE_RU: Record<string, string> = { post: 'пост', carousel: 'карусель', reels: 'рилз', stories: 'сторис', email: 'письмо', live: 'эфир' }

// Pull the user's saved "Готовое" library into context so the assistant can
// reference and edit it directly instead of asking the user to paste the text
// (a real pain point: "you saved it, why do you ask me for it?").
async function buildSavedBlock(
  supabase: Db,
  userId: string,
  projectId?: string,
): Promise<string> {
  try {
    const { data } = await supabase
      .from('saved_content')
      .select('content_type, title, body, created_at, project_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(40)
    let rows = data ?? []
    if (rows.length === 0) return ''
    // This project's saves first, then the rest (global / other projects).
    if (projectId) rows = [...rows.filter((r: { project_id?: string | null }) => r.project_id === projectId), ...rows.filter((r: { project_id?: string | null }) => r.project_id !== projectId)]

    let budget = 9000 // char budget so we never blow up the prompt
    const parts: string[] = []
    let n = 0
    for (const r of rows) {
      const body = String(r.body ?? '').trim()
      if (!body) continue
      const type = SAVED_TYPE_RU[String(r.content_type ?? '')] || 'контент'
      const title = (String(r.title ?? '') || body.split('\n')[0] || '').slice(0, 80)
      const entry = `[${n + 1}] ${type} — «${title}»\n${body}`
      if (parts.length > 0 && entry.length > budget) break
      parts.push(entry.length > 4000 ? entry.slice(0, 4000) + '…' : entry)
      budget -= entry.length
      n++
      if (budget <= 0) break
    }
    if (parts.length === 0) return ''
    return `

═══ СОХРАНЁННЫЙ КОНТЕНТ ПОЛЬЗОВАТЕЛЯ («Готовое») ═══
Ниже — контент, который пользователь УЖЕ сохранил в библиотеку «Готовое». Если он ссылается на ранее сохранённый/готовый рилз, пост, карусель, сторис и т.п. — НАЙДИ его в этом списке и работай с его текстом напрямую (покажи, поправь, перепиши, используй как основу). НЕ проси пользователя прислать текст, который уже есть здесь. Если нужного действительно нет — скажи, что не нашёл в «Готовом», и попроси уточнить.

${parts.join('\n\n———\n\n')}`
  } catch {
    return ''
  }
}

export async function buildStandaloneChatContext(supabase: Db, userId: string, lastMessage: string): Promise<{ systemBlocks: string[] }> {
  let sysKnowledge = ''
  try {
    const rag = await buildRAGContext(lastMessage, '00000000-0000-0000-0000-000000000000')
    sysKnowledge = rag.systemKnowledge.map(c => c.chunk_text).join('\n\n').slice(0, 4000)
  } catch { /* no system knowledge */ }

  const savedBlock = await buildSavedBlock(supabase, userId)

  const standaloneSystem = `Ты — AI-ассистент по контенту и запускам для блогеров и экспертов, построенный на проверенной методологии прогревов и продаж в блоге.

ТВОЯ РОЛЬ:
- Помогаешь любому блогеру/эксперту: подобрать нишу, протестировать гипотезу контента, придумать и НАПИСАТЬ пост/рилз/сторис/сценарий, собрать прогрев, разобрать идею.
- Когда просят написать — даёшь СРАЗУ готовый, живой контент (не «вот советы»), по законам залетающего контента: сильный хук в первые секунды, конкретика, эмоция, чёткий призыв.
- Отвечаешь живым человеческим языком, без воды и канцелярита, без хэштегов.
- Если не хватает вводных (ниша, продукт, аудитория) — задай 1-2 уточняющих вопроса, потом делай.

ФОРМАТ ОТВЕТА (ВАЖНО):
- НЕ используй markdown-разметку. НИКАКИХ **звёздочек**, ## решёток, --- тире-разделителей, * для списков, \`кода\`.
- Пиши чистым текстом, как реальный пост/сообщение. Разделяй смысловые блоки пустой строкой (воздух).
- Если нужен список — нумеруй просто «1.», «2.» с новой строки, без звёздочек.
- Заголовки выделяй просто КАПСОМ или эмодзи, а не ## и **.
- Если просят НЕСКОЛЬКО штук («5 рилзов», «10 идей») — выдай РОВНО столько, каждую полностью и пронумерованно. Не останавливайся на половине, не пиши «продолжить?» — доводи список до конца.

Ты сильнее обычного ChatGPT в контенте, потому что работаешь по конкретной методологии прогревов (ниже) и думаешь как продюсер запусков, а не как универсальный бот.

${AI_TELLS_TO_AVOID}

${sysKnowledge ? `═══ МЕТОДОЛОГИЯ (опирайся на неё) ═══\n${sysKnowledge}` : ''}`

  return { systemBlocks: [standaloneSystem, savedBlock] }
}

export async function buildProjectChatContext(opts: {
  supabase: Db; userId: string; projectId: string; project: Project
  genFormat?: string; messages: ChatMsg[]; images?: string[]
}): Promise<{ systemBlocks: string[]; outMessages: ChatMsg[] }> {
  const { supabase, userId, projectId, project, genFormat, messages, images } = opts
  const lastMessage = messages[messages.length - 1]?.content || ''
  let ragContext: RAGContext = { systemKnowledge: [], projectContext: [], styleExamples: [] }
  let queryMatches: RAGContext = { systemKnowledge: [], projectContext: [], styleExamples: [] }
  try {
    ;[ragContext, queryMatches] = await Promise.all([
      buildRAGContext('', projectId, undefined, { stableOnly: true }),
      buildRAGContext(lastMessage, projectId, undefined, { matchesOnly: true }),
    ])
  } catch {
    // RAG unavailable
  }

  const baseSystem = buildSystemPrompt(ragContext, project)
  const savedBlock = await buildSavedBlock(supabase, userId, projectId)

  // Wrap the content-generation system prompt with an ASSISTANT framing.
  // Personal content assistant for THIS blogger — grounded only in the
  // project's materials, speaking in their voice. Not a general chatbot.
  const systemPrompt = `Ты — личный AI-ассистент по контенту для этого блогера. Ты живёшь внутри его рабочего пространства и знаешь всё о его проекте из материалов ниже.

ТВОЯ РОЛЬ:
- Помогаешь с любым вопросом по контенту: придумать пост/рилз/сторис/карусель, доработать идею, накидать темы, переписать текст, собрать структуру, ответить по стратегии.
- Когда просят что-то написать — пишешь СРАЗУ готовый контент в голосе этого блогера, а не общие советы.
- Отвечаешь живо, по-человечески, без воды и канцелярита.

ЖЁСТКИЕ ПРАВИЛА:
1. Опирайся ТОЛЬКО на материалы проекта ниже (его голос, кейсы, аудитория, продукт, линии блога, анализ Instagram). НЕ выдумывай факты, цифры, кейсы и имена, которых нет в материалах.
2. Если данных не хватает — честно скажи чего не хватает и предложи что догрузить. Не придумывай.
3. Любой текст пиши голосом этого блогера (его словечки, ритм, воздух между абзацами), а не нейтральным «AI-языком». Без хэштегов.
4. Ты НЕ универсальный чат-бот «обо всём». Ты ассистент по контенту ЭТОГО проекта.
5. НЕ используй markdown: никаких **звёздочек**, ## решёток, --- разделителей, * списков, \`кода\`. Только чистый текст с пустыми строками между блоками, как реальный пост.
6. Если просят несколько штук («5 рилзов», «10 идей») — выдай РОВНО столько, сколько просят, каждую полностью и пронумерованно (1., 2., …). Не останавливайся на середине и не спрашивай «продолжать?» — доводи до конца.
7. ССЫЛКИ. Ты не открываешь ссылки — но НЕ отвечай «у меня нет доступа в интернет» и не проси прислать текст. Скажи, куда её вставить, чтобы система разобрала за тебя:
 • ссылка на залетевший рилз → раздел «Тренды» → блок «Залетевшие рилз — референсы» → вставить ссылку → «Добавить и разобрать». Система скачает рилз, расшифрует речь и разберёт формат, после чего ты увидишь этот разбор здесь и сможешь с ним работать.
 • ссылка на Instagram-аккаунт (свой или конкурента) → раздел «Материалы» → «Подключить Instagram» / «Добавить конкурентов».
 Если разборы рилзов уже есть в блоке «ЗАЛЕТЕВШИЕ РИЛЗЫ» выше — спокойно перечисляй их, выбирай под темы дня и предлагай адаптацию под голос блогера.
${genFormat ? `
═══ РЕЖИМ ГЕНЕРАЦИИ ЕДИНИЦЫ КОНТЕНТА (${genFormat}) ═══
Этот текст пользователь сохранит и опубликует как есть. Поэтому:
- Выдавай СРАЗУ только сам готовый текст контента, ничего лишнего.
- 🚫 НИКАКОГО JSON, фигурных скобок {}, ключей "key": или служебной разметки — только готовый человеческий текст. Для карусели/рилз/сторис разбивай на блоки ОБЫЧНЫМ текстом, каждый с новой строки (${(() => {
const l = resolveContentLanguage(project)
if (l === 'en') return '«Slide 1:», затем заголовок и текст; «Scene 1 (0-3 sec):», затем что на экране и озвучка — метки блоков тоже на английском'
if (l === 'es') return '«Diapositiva 1:», затем заголовок и текст; «Escena 1 (0-3 seg):», затем что на экране и озвучка — метки блоков тоже на испанском'
if (l === 'it') return '«Slide 1:», затем заголовок и текст; «Scena 1 (0-3 sec):», затем что на экране и озвучка — метки блоков тоже на итальянском'
if (l === 'de') return '«Slide 1:», затем заголовок и текст; «Szene 1 (0-3 Sek):», затем что на экране и озвучка — метки блоков тоже на немецком'
return '«Слайд 1:», затем заголовок и текст; «Сцена 1 (0-3 сек):», затем что на экране и озвучка'
})()}).
- НЕ начинай со вводных фраз («Окей», «Конечно», «Вот», «Держи», «Делаем», «Готово», «Отлично») и НЕ повторяй тему/задание перед текстом.
- НЕ добавляй комментарии после текста («Готово!», «Если нужно — поправлю», «Хочешь иначе?»).
- Первая строка ответа = первая строка контента. Последняя строка ответа = последняя строка контента.` : ''}

${baseSystem}`


  // Найденные под ЭТОТ вопрос фрагменты прикладываем к последнему сообщению,
  // а не в системный промпт: система остаётся байт-в-байт одинаковой весь
  // диалог (кэш читается), а релевантность хода не теряется. Для модели набор
  // токенов тот же — меняется только их место в запросе.
  const matchesBlock = [
    ...queryMatches.systemKnowledge.map(c => c.chunk_text),
    ...queryMatches.projectContext.map(c => c.chunk_text),
  ].filter(Boolean).join('\n\n').slice(0, 12000)
  const outMessages: ChatMsg[] = messages.map((m, i) => {
    const isLast = i === messages.length - 1
    const content = isLast && matchesBlock
      ? `${m.content}\n\n[СПРАВОЧНЫЕ ФРАГМЕНТЫ ПО ЭТОМУ ВОПРОСУ — материалы проекта и методология, используй если уместно]\n${matchesBlock}`
      : m.content
    return { role: m.role, content, ...(isLast ? { images } : {}) }
  })

  return { systemBlocks: [systemPrompt, savedBlock], outMessages }
}
