import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { action, projectId, data } = await request.json()

    if (action === 'create_warmup_plan') {
      const { data: plan, error } = await supabase
        .from('warmup_plans')
        .insert({ ...data, project_id: projectId })
        .select()
        .single()

      if (error) throw error
      return NextResponse.json({ planId: plan.id })
    }

    // Generate a quick content plan from project info — no wizard required
    if (action === 'generate_quick_plan') {
      const { duration = 45 } = data || {}

      // Fetch project to get product names
      const { data: project } = await supabase
        .from('projects')
        .select('name, description, target_audience')
        .eq('id', projectId)
        .single()

      const { data: products } = await supabase
        .from('products')
        .select('name')
        .eq('project_id', projectId)
        .limit(3)

      const productName = products?.[0]?.name || project?.name || 'продукт'

      // Build structured plan_data with phases and daily themes
      const phases: Array<{ phase: string; ratio: number; themes: string[] }> = [
        { phase: 'awareness', ratio: 0.25, themes: ['Знакомство с экспертом', 'Моя история', 'Зачем этот блог', 'Кому я помогаю', 'Мои ценности', 'Факты обо мне', 'Антикейс — чего я не делаю'] },
        { phase: 'trust',     ratio: 0.30, themes: ['Кейс клиента', 'За кулисами работы', 'Отзывы и результаты', 'Мой метод', 'Частые вопросы', 'Разбор мифа', 'Почему я в этой нише'] },
        { phase: 'desire',    ratio: 0.28, themes: ['Что изменится после', 'Боль без решения', 'Трансформация клиента', 'Детали продукта', 'Результаты за X дней', 'Сравнение до/после', 'Почему сейчас'] },
        { phase: 'close',     ratio: 0.17, themes: [`Открываю продажи: ${productName}`, 'Что входит в программу', 'Ответы на возражения', 'Осталось мест', 'Последний шанс', 'Бонусы для первых', 'Итог запуска'] },
      ]

      const contentRotation: string[][] = [
        ['post', 'stories'], ['reels'], ['carousel', 'stories'], ['stories'],
        ['post'], ['reels', 'stories'], ['carousel'],
      ]

      let dayCounter = 1
      const planPhases = phases.map(({ phase, ratio, themes }) => {
        const phaseDays = Math.round(duration * ratio)
        const daily_plan = Array.from({ length: phaseDays }, (_, i) => {
          const themeIdx = i % themes.length
          const formatIdx = (dayCounter - 1) % contentRotation.length
          const entry = {
            day: dayCounter,
            format: contentRotation[formatIdx] as string[],
            theme: themes[themeIdx],
          }
          dayCounter++
          return entry
        })
        return { phase, daily_plan }
      })

      const plan_data = { warmup_plan: { phases: planPhases } }

      const { data: plan, error } = await supabase
        .from('warmup_plans')
        .insert({
          project_id: projectId,
          name: `Быстрый план — ${productName} (${duration} дней)`,
          duration_days: duration,
          audience_type: 'cold_warm',
          status: 'approved',
          strategic_summary: `Автоматически составленный план прогрева на ${duration} дней для продукта «${productName}». Пройди мастер «План прогрева» для персонализированной стратегии.`,
          summary_approved: true,
          plan_data,
        })
        .select()
        .single()

      if (error) throw error
      return NextResponse.json({ planId: plan.id })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { action, contentItemId, bodyText } = await request.json()

    if (action === 'approve_content') {
      const { error } = await supabase
        .from('content_items')
        .update({ is_approved: true, body_text: bodyText })
        .eq('id', contentItemId)

      if (error) throw error
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
