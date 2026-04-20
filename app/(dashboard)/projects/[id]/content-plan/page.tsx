'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Sparkles, AlertCircle } from 'lucide-react'
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
}

function buildDaysFromWarmupPlan(planData: WarmupPlanData, weekNumber: number, startDay: number): DayData[] {
  // Flatten all daily_plan entries from all phases
  const allDays: Array<{ day: number; phase: WarmupPhase; format: ContentType[]; theme: string }> = []

  for (const phaseData of planData.warmup_plan.phases) {
    for (const dayPlan of phaseData.daily_plan) {
      allDays.push({
        day: dayPlan.day,
        phase: phaseData.phase,
        format: dayPlan.format,
        theme: dayPlan.theme,
      })
    }
  }

  allDays.sort((a, b) => a.day - b.day)

  // Get the 7-day window for this week
  const weekStart = (weekNumber - 1) * 7 + 1
  const weekDays = allDays.filter((d) => d.day >= weekStart && d.day < weekStart + 7)

  return weekDays.map((d, i) => {
    const absDay = startDay + d.day - 1
    const date = new Date()
    date.setDate(date.getDate() + d.day - 1)
    const dd = String(date.getDate()).padStart(2, '0')
    const mm = String(date.getMonth() + 1).padStart(2, '0')

    return {
      day: d.day,
      date: `${dd}.${mm}`,
      dayOfWeek: DAYS_OF_WEEK[(absDay - 1) % 7],
      items: [],
      plannedTypes: d.format,
      phase: d.phase,
      theme: d.theme,
    }
  })
}

function buildFallbackDays(weekNumber: number, totalDays: number): DayData[] {
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
    return {
      day: dayNum,
      date: `${String(dayNum).padStart(2, '0')}.`,
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

        if (warmupPlan.plan_data) {
          const planData = warmupPlan.plan_data as WarmupPlanData
          if (planData?.warmup_plan?.phases?.length > 0) {
            const builtDays = buildDaysFromWarmupPlan(planData, weekNum, 1)
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
        setDays(buildFallbackDays(weekNum, duration))
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
        setDays(buildFallbackDays(weekNum, draftPlan?.duration_days || 45))
      }
    } catch (err) {
      console.error('Error loading plan data:', err)
      setDays(buildFallbackDays(weekNum, 45))
    } finally {
      setLoading(false)
    }
  }, [id, supabase])

  useEffect(() => {
    loadPlanData(week)
  }, [week, loadPlanData])

  const handleGenerate = useCallback(async (day: number, contentType: ContentType, phase: WarmupPhase) => {
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
        }),
      })
      if (!res.ok) throw new Error('Generation failed')
      const data = await res.json()
      // Update local state with the new item
      setDays((prev) => prev.map((d) =>
        d.day === day
          ? { ...d, items: [...d.items, data.item] }
          : d
      ))
      toast.success(`${contentType} для дня ${day} сгенерирован`)
    } catch {
      toast.error('Ошибка создания контента')
    }
  }, [id, totalDays])

  const handleExport = useCallback(async () => {
    toast.info('Экспорт контент-плана в разработке...')
  }, [])

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

      {/* No approved plan warning */}
      {!hasPlan && !loading && (
        <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-yellow-400">Стратегия прогрева не одобрена</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Показан предварительный план. Создай стратегию в разделе «План прогрева» — и план заполнится реальными темами и форматами.
            </p>
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
          onGenerate={handleGenerate}
          onExport={handleExport}
          loading={false}
        />
      )}
    </div>
  )
}
