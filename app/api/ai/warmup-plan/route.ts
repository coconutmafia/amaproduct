import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/client'

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const {
      projectId, productName, duration, startDate, funnelDesc,
      warmTypes, useCases, hooks, extraHooks, competitors,
    }: {
      projectId: string; productName: string; duration: number
      startDate?: string; funnelDesc: string; warmTypes: string[]
      useCases: boolean; hooks: string[]; extraHooks?: string; competitors?: string
    } = await request.json()

    const { data: project } = await supabase
      .from('projects')
      .select('id, name, niche, description, target_audience')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    // Load project materials for personalization (no embeddings needed)
    const { data: chunks } = await supabase
      .from('project_chunks')
      .select('chunk_text, material_type')
      .eq('project_id', projectId)
      .limit(25)

    const materialsText = chunks && chunks.length > 0
      ? chunks.map(c => `[${c.material_type}]: ${c.chunk_text}`).join('\n\n').slice(0, 4000)
      : ''

    const p1 = Math.round(duration * 0.25)
    const p2 = Math.round(duration * 0.25)
    const p3 = Math.round(duration * 0.25)
    const p4 = duration - p1 - p2 - p3

    const hooksText = hooks.length ? hooks.join(', ') : 'не выбраны'

    const prompt = `Ты эксперт по контент-маркетингу и прогревам. Создай детальный план прогрева.

ПАРАМЕТРЫ ЗАПУСКА:
- Продукт: ${productName}
- Длительность: ${duration} дней${startDate ? `, старт: ${startDate}` : ''}
- Ниша блогера: ${project.niche || project.name}
- ЦА: ${project.target_audience || 'не указана'}
- Воронка: ${funnelDesc}
- Механики прогрева: ${warmTypes.join(', ')}
- Кейсы клиентов: ${useCases ? 'есть, использовать' : 'нет'}
- Смысловые крючки из карты смыслов: ${hooksText}${extraHooks ? `\n- Доп. смыслы: ${extraHooks}` : ''}${competitors ? `\n- Конкуренты/отличия: ${competitors}` : ''}

${materialsText ? `МАТЕРИАЛЫ ПРОЕКТА (используй для персонализации — это реальные данные от блогера):
${materialsText}` : ''}

МЕТОДОЛОГИЯ (строго соблюдай):
Прогрев делится на 4 этапа. На каждый день — 1-2 КОНКРЕТНЫХ СМЫСЛА (о чём говорить). Никаких форматов контента (не пиши "пост", "сторис", "рилс") — только смыслы.

ЭТАПЫ:
- Фаза 1 ПРОГРЕВ НА НИШУ (дни 1–${p1}, ${p1} дней): Продаём ИДЕЮ ниши — почему человеку вообще важна эта тема. Не ты, не продукт — сама категория. Аудитория ещё на уровне "а мне это надо?"
- Фаза 2 ПРОГРЕВ НА ЭКСПЕРТА (дни ${p1+1}–${p1+p2}, ${p2} дней): Продаём ТЕБЯ как проводника. "Окей, тема важная — но почему именно этот человек?" Твоя история, опыт, результаты, уникальный взгляд.
- Фаза 3 ПРОГРЕВ НА ПРОДУКТ (дни ${p1+p2+1}–${p1+p2+p3}, ${p3} дней): Продаём МЕХАНИЗМ решения — что именно получит человек, как устроен продукт, почему именно так.
- Фаза 4 ОТРАБОТКА ВОЗРАЖЕНИЙ (дни ${p1+p2+p3+1}–${duration}, ${p4} дней): Убираем последнее сопротивление — возражения, страхи, дедлайн, FOMO, отзывы, сравнение "купить vs не купить".

ФОРМАТ ОТВЕТА (строго — только это, без лишнего):

# ПЛАН ПРОГРЕВА: ${productName} | ${duration} дней

## Общая информация
| Параметр | Значение |
|---|---|
| Продукт | ${productName} |
| Длительность | ${duration} дней |
| Старт | ${startDate || 'по согласованию'} |
| Воронка | ${funnelDesc} |

---

## 🔥 Фаза 1: Прогрев на нишу (дни 1–${p1})

**Задача:** Создать осознание — "эта тема важна для меня лично"

| День | Смыслы (о чём говорить) |
|---|---|
[для каждого дня с 1 по ${p1}: "| День X | Смысл 1 / Смысл 2 |" — конкретные смыслы из материалов проекта, не общие]

---

## 💡 Фаза 2: Прогрев на эксперта (дни ${p1+1}–${p1+p2})

**Задача:** "Почему именно этот человек?" — экспертность, опыт, позиция

| День | Смыслы (о чём говорить) |
|---|---|
[для каждого дня с ${p1+1} по ${p1+p2}: конкретные смыслы из карты смыслов и распаковки]

---

## 🎯 Фаза 3: Прогрев на продукт (дни ${p1+p2+1}–${p1+p2+p3})

**Задача:** "Как именно это работает?" — механизм, структура, путь клиента

| День | Смыслы (о чём говорить) |
|---|---|
[для каждого дня с ${p1+p2+1} по ${p1+p2+p3}: смыслы про продукт, детали, результаты]

---

## 💰 Фаза 4: Отработка возражений (дни ${p1+p2+p3+1}–${duration})

**Задача:** Убрать последнее сопротивление — закрыть возражения, создать дефицит

| День | Смыслы (о чём говорить) |
|---|---|
[для каждого дня с ${p1+p2+p3+1} по ${duration}: конкретные возражения и как закрывать, FOMO, дедлайн]

---

## Ключевые смыслы из карты смыслов
[как смысловые крючки распределяются по фазам — 3-5 строк]`

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8096,
      messages: [{ role: 'user', content: prompt }],
    })

    const plan = response.content[0]?.type === 'text' ? response.content[0].text : ''
    if (!plan.trim()) throw new Error('Пустой ответ от AI')

    return NextResponse.json({ plan })
  } catch (error) {
    console.error('Warmup plan AI error:', error)
    let humanMsg = 'AI недоступен'
    if (error instanceof Error) {
      const raw = error.message
      try {
        const jsonStart = raw.indexOf('{')
        if (jsonStart !== -1) {
          const parsed = JSON.parse(raw.slice(jsonStart)) as { error?: { type?: string; message?: string } }
          const inner = parsed?.error?.message || ''
          if (inner) {
            if (inner.includes('credit') || inner.includes('balance')) humanMsg = 'Закончились кредиты Anthropic. Пополните баланс на console.anthropic.com'
            else if (inner.includes('credential') || inner.includes('API key') || inner.includes('auth')) humanMsg = 'Неверный API ключ Anthropic'
            else humanMsg = inner
          }
        } else { humanMsg = raw }
      } catch { humanMsg = raw }
    }
    return NextResponse.json({ error: humanMsg }, { status: 500 })
  }
}
