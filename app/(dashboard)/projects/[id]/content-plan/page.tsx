'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Sparkles, AlertCircle, Zap } from 'lucide-react'
import { ContentPlanGrid } from '@/components/content/ContentPlanGrid'
import { toast } from 'sonner'
import type { ContentItem, ContentType, WarmupPhase, WarmupPlanData, WarmupPhaseData } from '@/types'

const DAYS_OF_WEEK = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС']

interface DayData {
  day: number
  date: string
  dayOfWeek: string
  items: ContentItem[]
  plannedTypes: ContentType[]
  phase: WarmupPhase
  theme?: string
  dayBriefs?: Record<string, string>
}

function buildDaysFromWarmupPlan(planData: WarmupPlanData, weekNumber: number, startDay: number, baseDate?: Date): DayData[] {
  // Flatten all daily_plan entries from all phases
  const allDays: Array<{ day: number; phase: WarmupPhase; format: ContentType[]; theme: string }> = []

  for (const phaseData of planData.warmup_plan.phases) {
    for (const dayPlan of phaseData.daily_plan) {
      // Support both old format (format+theme) and new format (meaning)
      const dayData = dayPlan as unknown as Record<string, unknown>
      allDays.push({
        day: dayPlan.day,
        phase: phaseData.phase as WarmupPhase,
        format: (dayData.format as ContentType[]) || [],
        theme: (dayData.meaning as string) || (dayData.theme as string) || '',
      })
    }
  }

  allDays.sort((a, b) => a.day - b.day)

  // Get the 7-day window for this week
  const weekStart = (weekNumber - 1) * 7 + 1
  const weekDays = allDays.filter((d) => d.day >= weekStart && d.day < weekStart + 7)

  return weekDays.map((d, i) => {
    const absDay = startDay + d.day - 1
    const base = baseDate ? new Date(baseDate) : new Date()
    base.setDate(base.getDate() + d.day - 1)
    const date = base
    const dd = String(date.getDate()).padStart(2, '0')
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const yyyy = date.getFullYear()

    return {
      day: d.day,
      date: `${dd}.${mm}.${yyyy}`,
      dayOfWeek: DAYS_OF_WEEK[(absDay - 1) % 7],
      items: [],
      plannedTypes: d.format,
      phase: d.phase,
      theme: d.theme,
    }
  })
}

function buildFallbackDays(weekNumber: number, totalDays: number, baseDate?: Date): DayData[] {
  const phases: WarmupPhase[] = ['awareness', 'trust', 'desire', 'close']
  const types: ContentType[][] = [
    ['reels', 'stories'], ['post'], ['carousel', 'stories'],
    ['stories'], ['carousel'], ['post'], [],
  ]

  const weekStart = (weekNumber - 1) * 7 + 1
  return Array.from({ length: 7 }, (_, i) => {
    const dayNum = weekStart + i
    if (dayNum > totalDays) return null
    const phaseIndex = Math.floor(((dayNum - 1) / totalDays) * 4)
    const d = baseDate ? new Date(baseDate) : new Date()
    d.setDate(d.getDate() + dayNum - 1)
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = d.getFullYear()
    return {
      day: dayNum,
      date: `${dd}.${mm}.${yyyy}`,
      dayOfWeek: DAYS_OF_WEEK[i],
      items: [],
      plannedTypes: types[i % 7] as ContentType[],
      phase: phases[Math.min(phaseIndex, 3)],
    }
  }).filter(Boolean) as DayData[]
}

export default function ContentPlanPage() {
  const params = useParams()
  const id = params.id as string
  const supabase = createClient()

  const [week, setWeek] = useState(1)
  const [days, setDays] = useState<DayData[]>([])
  const [totalDays, setTotalDays] = useState(45)
  const [totalWeeks, setTotalWeeks] = useState(7)
  const [planName, setPlanName] = useState<string | null>(null)
  const [hasPlan, setHasPlan] = useState(false)
  const [loading, setLoading] = useState(true)
  const [generatingQuickPlan, setGeneratingQuickPlan] = useState(false)

  // Load warmup plan data
  const loadPlanData = useCallback(async (weekNum: number) => {
    try {
      // Fetch the latest approved warmup plan for this project
      const { data: warmupPlan } = await supabase
        .from('warmup_plans')
        .select('*')
        .eq('project_id', id)
        .in('status', ['approved', 'active'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (warmupPlan) {
        const duration = warmupPlan.duration_days || 45
        setTotalDays(duration)
        setTotalWeeks(Math.ceil(duration / 7))
        setPlanName(warmupPlan.name)
        setHasPlan(true)

        // Extract start date: from plan_data.meta.start_date first, then from name as fallback
        const metaStartDate = (warmupPlan.plan_data as Record<string, unknown> | null)
          ?.meta as Record<string, string> | undefined
        const startDateStr = metaStartDate?.start_date
          || warmupPlan.name?.match(/старт (\d{4}-\d{2}-\d{2})/)?.[1]
          || null
        const planBaseDate = startDateStr ? new Date(startDateStr + 'T00:00:00') : undefined

        if (warmupPlan.plan_data) {
          const planData = warmupPlan.plan_data as WarmupPlanData
          if (planData?.warmup_plan?.phases?.length > 0) {
            const builtDays = buildDaysFromWarmupPlan(planData, weekNum, 1, planBaseDate)
            if (builtDays.length > 0) {
              // Fetch existing generated content for these days
              const dayNumbers = builtDays.map((d) => d.day)
              const { data: existingItems } = await supabase
                .from('content_items')
                .select('*')
                .eq('project_id', id)
                .in('day_number', dayNumbers)

              const mergedDays = builtDays.map((d) => ({
                ...d,
                items: (existingItems || []).filter((item) => item.day_number === d.day) as ContentItem[],
              }))
              setDays(mergedDays)
              return
            }
          }
        }
        // Plan exists but no structured plan_data yet — use fallback with correct duration
        setDays(buildFallbackDays(weekNum, duration, planBaseDate))
      } else {
        // No approved plan — check for any draft
        const { data: draftPlan } = await supabase
          .from('warmup_plans')
          .select('duration_days, name')
          .eq('project_id', id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (draftPlan) {
          setTotalDays(draftPlan.duration_days || 45)
          setTotalWeeks(Math.ceil((draftPlan.duration_days || 45) / 7))
          setPlanName(draftPlan.name)
        }
        setHasPlan(false)
        setDays(buildFallbackDays(weekNum, draftPlan?.duration_days || 45, undefined))
      }
    } catch (err) {
      console.error('Error loading plan data:', err)
      setDays(buildFallbackDays(weekNum, 45, undefined))
    } finally {
      setLoading(false)
    }
  }, [id, supabase])

  useEffect(() => {
    loadPlanData(week)
  }, [week, loadPlanData])

  const handleGenerate = useCallback(async (day: number, contentType: ContentType, phase: WarmupPhase, theme?: string) => {
    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: id,
          contentType,
          dayNumber: day,
          totalDays,
          phase,
          dayMeaning: theme || undefined,
        }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error((errData as { error?: string }).error || 'Generation failed')
      }

      // Read SSE stream — wait for 'done' event
      const reader = res.body?.getReader()
      if (!reader) throw new Error('Нет потока')
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        // Process value BEFORE checking done — last chunk may arrive with done:true
        if (value) {
          buffer += decoder.decode(value, { stream: !done })
          const parts = buffer.split('\n\n')
          buffer = parts.pop() ?? ''
          let finished = false
          for (const part of parts) {
            if (!part.startsWith('data: ')) continue
            let data: { type: string; item?: ContentItem; message?: string }
            try { data = JSON.parse(part.slice(6)) } catch { continue }
            if (data.type === 'done' && data.item) {
              setDays((prev) => prev.map((d) =>
                d.day === day ? { ...d, items: [...d.items, data.item!] } : d
              ))
              toast.success(`${contentType} для дня ${day} сгенерирован`)
              finished = true
              break
            }
            if (data.type === 'error') throw new Error(data.message || 'Ошибка')
          }
          if (finished) return
        }
        if (done) break
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ошибка создания контента')
    }
  }, [id, totalDays])

  const handleRemoveType = useCallback((dayNum: number, type: ContentType) => {
    setDays(prev => prev.map(d =>
      d.day === dayNum ? { ...d, plannedTypes: (d.plannedTypes || []).filter(t => t !== type) } : d
    ))
  }, [])

  const handleAddType = useCallback((dayNum: number, type: ContentType) => {
    setDays(prev => prev.map(d =>
      d.day === dayNum && !(d.plannedTypes || []).includes(type)
        ? { ...d, plannedTypes: [...(d.plannedTypes || []), type] }
        : d
    ))
  }, [])

  const handleGenerateWeekBrief = useCallback(async () => {
    const briefDays = days.filter(d => d.phase).map(d => ({
      day: d.day,
      date: d.date,
      phase: d.phase,
      meaning: d.theme || '',
    }))
    if (!briefDays.length) {
      toast.error('Нет данных плана прогрева для этой недели')
      return
    }
    try {
      const res = await fetch('/api/ai/generate-week-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: id, days: briefDays }),
      })
      if (!res.ok) throw new Error('Ошибка генерации плана')
      const data = await res.json() as { days: Array<{ day: number; brief: Record<string, string> }> }
      // Update themes in days state
      setDays(prev => prev.map(d => {
        const briefDay = data.days.find(b => b.day === d.day)
        if (!briefDay) return d
        // Merge: set theme to main brief text, add types if missing
        const newTheme = Object.values(briefDay.brief).join(' · ')
        const addTypes = Object.keys(briefDay.brief) as ContentType[]
        const existingTypes = d.plannedTypes || []
        const mergedTypes = [...new Set([...existingTypes, ...addTypes])]
        return { ...d, theme: newTheme, plannedTypes: mergedTypes, dayBriefs: briefDay.brief }
      }))
      toast.success('План недели готов! Кликай на тип контента чтобы сгенерировать')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ошибка')
    }
  }, [id, days])

  const handleExport = useCallback(async () => {
    toast.info('Экспорт контент-плана в разработке...')
  }, [])

  const handleQuickPlan = useCallback(async () => {
    setGeneratingQuickPlan(true)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_quick_plan',
          projectId: id,
          data: { duration: totalDays },
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Ошибка создания плана')
      }
      toast.success('Быстрый контент-план создан! 🎉')
      await loadPlanData(1)
      setWeek(1)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setGeneratingQuickPlan(false)
    }
  }, [id, totalDays, loadPlanData])

  const handleWeekChange = (delta: number) => {
    const newWeek = Math.max(1, Math.min(totalWeeks, week + delta))
    setWeek(newWeek)
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
          <Link href={`/projects/${id}`}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-foreground">Контент-план</h1>
          <p className="text-sm text-muted-foreground">
            {planName ? planName : 'Кликайте на тип контента, чтобы сгенерировать'}
            {totalDays && ` · ${totalDays} дней`}
          </p>
        </div>
        {!hasPlan && (
          <Link href={`/projects/${id}/strategy`}>
            <Button size="sm" variant="outline" className="border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 text-xs gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" />
              Создать стратегию
            </Button>
          </Link>
        )}
      </div>

      {/* No approved plan — offer two paths */}
      {!hasPlan && !loading && (
        <div className="rounded-xl border border-border bg-secondary/30 p-5 space-y-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">У тебя ещё нет одобренного плана прогрева</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ниже показана предварительная структура. Выбери как хочешь продолжить:
              </p>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {/* Quick plan */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold text-foreground">Быстрый старт</p>
              </div>
              <p className="text-xs text-muted-foreground">
                AI создаст структуру контент-плана на {totalDays} дней прямо сейчас — на основе информации проекта. Темы и форматы для каждого дня будут готовы за секунду.
              </p>
              <Button
                size="sm"
                className="w-full gradient-accent text-white hover:opacity-90 mt-1"
                onClick={handleQuickPlan}
                disabled={generatingQuickPlan}
              >
                {generatingQuickPlan
                  ? <><span className="animate-spin mr-1.5">⏳</span> Создаём план...</>
                  : <><Zap className="h-3.5 w-3.5 mr-1.5" /> Создать контент-план</>
                }
              </Button>
            </div>
            {/* Full wizard */}
            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-semibold text-foreground">Персональная стратегия</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Пройди мастер «План прогрева» — AI учтёт твою воронку, продукт, типы прогрева и хуки. Результат точнее под твой запуск.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="w-full mt-1"
                asChild
              >
                <Link href={`/projects/${id}/strategy`}>
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Открыть мастер
                </Link>
              </Button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="text-muted-foreground text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 animate-pulse text-primary" />
            Загрузка контент-плана...
          </div>
        </div>
      ) : (
        <ContentPlanGrid
          projectId={id}
          weekNumber={week}
          days={days}
          onWeekChange={handleWeekChange}
          onGenerate={(day, contentType, phase) => {
            const dayData = days.find(d => d.day === day)
            return handleGenerate(day, contentType, phase, dayData?.theme)
          }}
          onGenerateWeekBrief={handleGenerateWeekBrief}
          onExport={handleExport}
          onRemoveType={handleRemoveType}
          onAddType={handleAddType}
          loading={false}
        />
      )}
    </div>
  )
}
