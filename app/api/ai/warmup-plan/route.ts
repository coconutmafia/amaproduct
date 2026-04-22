import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/client'

// Non-streaming endpoint — faster and more reliable than /api/ai/chat for plan generation
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const {
      projectId,
      productName,
      duration,
      startDate,
      funnelDesc,
      warmTypes,
      useCases,
      hooks,
      extraHooks,
      competitors,
    }: {
      projectId: string
      productName: string
      duration: number
      startDate?: string
      funnelDesc: string
      warmTypes: string[]
      useCases: boolean
      hooks: string[]
      extraHooks?: string
      competitors?: string
    } = await request.json()

    // Verify project ownership
    const { data: project } = await supabase
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single()

    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const p1 = Math.round(duration * 0.15)
    const p2 = Math.round(duration * 0.25)
    const p3 = Math.round(duration * 0.30)
    const p4 = duration - p1 - p2 - p3

    const prompt = `Ты эксперт по контент-маркетингу. Создай план прогрева аудитории.

ПАРАМЕТРЫ:
- Продукт: ${productName}
- Длительность: ${duration} дней${startDate ? `, старт: ${startDate}` : ''}
- Воронка: ${funnelDesc}
- Форматы прогрева: ${warmTypes.join(', ')}
- Кейсы: ${useCases ? 'да' : 'нет'}
- Смысловые крючки: ${hooks.length ? hooks.join(', ') : 'не выбраны'}${extraHooks ? `\n- Доп. смыслы: ${extraHooks}` : ''}${competitors ? `\n- Конкуренты/отличия: ${competitors}` : ''}

ФАЗЫ (строго соблюдай длительность):
- Фаза 1 (активация, дни 1–${p1}): ${p1} дней
- Фаза 2 (доверие, дни ${p1 + 1}–${p1 + p2}): ${p2} дней
- Фаза 3 (желание, дни ${p1 + p2 + 1}–${p1 + p2 + p3}): ${p3} дней
- Фаза 4 (продажи, дни ${p1 + p2 + p3 + 1}–${duration}): ${p4} дней

Верни ТОЛЬКО план в этом формате (без лишнего текста):

# ПЛАН ПРОГРЕВА: ${productName} | ${duration} дней

## Общая информация
| Параметр | Значение |
|---|---|
| Продукт | ${productName} |
| Длительность | ${duration} дней |
| Старт | ${startDate || 'по согласованию'} |
| Воронка | ${funnelDesc} |

## 🔥 Фаза 1: Активация (дни 1–${p1})
**Цель:** Разбудить аудиторию — переключить с «у меня всё ок» в «мне нужно решение»
**Контент:**
- [3–4 конкретных типа контента для этой ниши]
**Механики:** опросы, диагностика, провокационные вопросы

## 💡 Фаза 2: Доверие и экспертность (дни ${p1 + 1}–${p1 + p2})
**Цель:** Показать компетентность, личные ценности, создать связь с аудиторией
**Контент:**
- [3–4 типа контента]
${useCases ? '**Кейсы:** истории клиентов с конкретными результатами' : '**Демонстрация метода:** пошаговые примеры без кейсов'}

## 🎯 Фаза 3: Желание (дни ${p1 + p2 + 1}–${p1 + p2 + p3})
**Цель:** Показать трансформацию, закрыть возражения, усилить желание
**Контент:**
- [4–5 типов контента]
**Возражения:** [2–3 ключевых возражения для ниши и как их закрыть]

## 💰 Фаза 4: Продажи (дни ${p1 + p2 + p3 + 1}–${duration})
**Цель:** Конвертировать прогретую аудиторию с дефицитом и ограниченным окном
**Механики:**
- Early Bird: бонус/скидка первым покупателям (24–48 часов)
- Окно продаж: 5–7 дней, жёсткий дедлайн
- Ежедневная работа с возражениями в сторис
**Контент:**
- [3–4 типа продающего контента]

## Распределение форматов
| Формат | Частота |
|---|---|
| Сторис | Ежедневно |
| Посты/карусели | 3–4 раза в неделю |
| Reels | 2–3 раза в неделю |
| Прямые эфиры | 1–2 в фазах 3–4 |`

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    })

    const plan = response.content[0]?.type === 'text' ? response.content[0].text : ''
    if (!plan.trim()) throw new Error('Пустой ответ от AI')

    return NextResponse.json({ plan })
  } catch (error) {
    console.error('Warmup plan AI error:', error)
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg || 'AI недоступен' }, { status: 500 })
  }
}
