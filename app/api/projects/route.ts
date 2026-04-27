import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { action, projectId, data } = await request.json()

    if (action === 'delete_warmup_plan') {
      const { planId } = data as { planId: string }
      const { error } = await supabase
        .from('warmup_plans')
        .delete()
        .eq('id', planId)
        .eq('project_id', projectId)
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    if (action === 'create_warmup_plan') {
      const { data: plan, error } = await supabase
        .from('warmup_plans')
        .insert({ ...data, project_id: projectId })
        .select()
        .single()

      if (error) {
        console.error('create_warmup_plan error:', error)
        return NextResponse.json({ error: error.message || error.details || 'DB insert failed' }, { status: 500 })
      }
      return NextResponse.json({ planId: plan.id })
    }

    // Generate a quick content plan from project info — no wizard required
    if (action === 'generate_quick_plan') {
      const { duration = 45 } = data || {}

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
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { action } = body

    if (action === 'approve_content') {
      const { contentItemId, bodyText } = body
      const { error } = await supabase
        .from('content_items')
        .update({ is_approved: true, body_text: bodyText })
        .eq('id', contentItemId)
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    if (action === 'update_project') {
      const { projectId, fields } = body as {
        projectId: string
        fields: {
          name?: string; niche?: string; description?: string
          target_audience?: string; content_goals?: string
          instagram_url?: string; telegram_url?: string
          vk_url?: string; youtube_url?: string
          status?: 'active' | 'draft' | 'archived'
        }
      }
      // Verify ownership first
      const { data: project } = await supabase
        .from('projects').select('id').eq('id', projectId).eq('owner_id', user.id).single()
      if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      const { error } = await supabase.from('projects').update(fields).eq('id', projectId)
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('id')
    if (!projectId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('owner_id', user.id)
      .single()

    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { error } = await supabase.from('projects').delete().eq('id', projectId)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
