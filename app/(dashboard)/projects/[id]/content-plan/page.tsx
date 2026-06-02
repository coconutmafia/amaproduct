'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Sparkles, AlertCircle, Zap, HelpCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { ContentPlanGrid } from '@/components/content/ContentPlanGrid'
import { AiEditChat } from '@/components/ai/AiEditChat'
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

  // Seed defaults at construction time when the warmup plan doesn't specify
  // formats for a day. Empty plannedTypes from the plan would otherwise be
  // indistinguishable from "user deliberately removed everything" — and the
  // UI now respects an empty array as truly empty (no defaults at render).
  const DEFAULT_FORMATS: ContentType[] = ['post', 'stories', 'reels']

  // Per-day saved briefs (themes per content format), populated below.
  const savedBriefs: Record<number, Record<string, string>> = {}

  for (const phaseData of planData.warmup_plan.phases) {
    for (const dayPlan of phaseData.daily_plan) {
      // Support both old format (format+theme) and new format (meaning)
      const dayData = dayPlan as unknown as Record<string, unknown>
      // `formats` = user's saved format choice; `format` = legacy plan field
      const savedFmt = (dayData.formats as ContentType[]) || (dayData.format as ContentType[]) || []
      const briefs = dayData.briefs as Record<string, string> | undefined
      if (briefs && Object.keys(briefs).length > 0) savedBriefs[dayPlan.day] = briefs
      allDays.push({
        day: dayPlan.day,
        phase: phaseData.phase as WarmupPhase,
        // An empty saved `formats` is a deliberate "user removed all" only if
        // briefs exist for that day; otherwise fall back to defaults.
        format: savedFmt.length > 0 ? savedFmt : (briefs ? [] : DEFAULT_FORMATS),
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
      dayBriefs: savedBriefs[d.day],
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
  const [warmupPlanId, setWarmupPlanId] = useState<string | null>(null)
  // Full plan_data kept in state so we can persist per-day briefs/formats back.
  const [planData, setPlanData] = useState<WarmupPlanData | null>(null)
  const [hasPlan, setHasPlan] = useState(false)
  const [loading, setLoading] = useState(true)
  const [generatingQuickPlan, setGeneratingQuickPlan] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

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
        setWarmupPlanId(warmupPlan.id)
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
            setPlanData(planData)
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

  // Defaults are seeded at day construction (buildDaysFromWarmupPlan), so
  // plannedTypes is never empty unless the user deliberately emptied it.
  // Add/remove operate on the literal current array — an empty array stays
  // empty after add? No: add appends; remove from empty is a no-op (no chip
  // is visible to click anyway).
  // Persist per-day format choices + generated briefs into warmup_plans.plan_data
  // so the week plan survives a page reload / week switch. Only days present in
  // `currentDays` (the visible week) are touched — other weeks keep their data.
  const persistPlan = useCallback(async (currentDays: DayData[]) => {
    if (!warmupPlanId || !planData) return
    const byDay = new Map(currentDays.map(d => [d.day, d]))
    const next = JSON.parse(JSON.stringify(planData)) as WarmupPlanData
    for (const phase of next.warmup_plan.phases) {
      for (const dp of phase.daily_plan) {
        const d = byDay.get(dp.day)
        if (!d) continue
        const e = dp as unknown as Record<string, unknown>
        e.formats = d.plannedTypes ?? []
        if (d.dayBriefs && Object.keys(d.dayBriefs).length > 0) e.briefs = d.dayBriefs
      }
    }
    setPlanData(next)
    const { error } = await supabase.from('warmup_plans').update({ plan_data: next }).eq('id', warmupPlanId)
    if (error) console.error('persistPlan error:', error)
  }, [warmupPlanId, planData, supabase])

  const handleRemoveType = useCallback((dayNum: number, type: ContentType) => {
    setDays(prev => {
      const next = prev.map(d =>
        d.day === dayNum
          ? { ...d, plannedTypes: (d.plannedTypes ?? []).filter(t => t !== type) }
          : d
      )
      void persistPlan(next)
      return next
    })
  }, [persistPlan])

  const handleAddType = useCallback((dayNum: number, type: ContentType) => {
    setDays(prev => {
      const next = prev.map(d => {
        if (d.day !== dayNum) return d
        const base = d.plannedTypes ?? []
        return base.includes(type) ? d : { ...d, plannedTypes: [...base, type] }
      })
      void persistPlan(next)
      return next
    })
  }, [persistPlan])

  const handleGenerateWeekBrief = useCallback(async () => {
    const briefDays = days.filter(d => d.phase).map(d => ({
      day: d.day,
      date: d.date,
      phase: d.phase,
      meaning: d.theme || '',
      // pass the formats the user actually chose — the AI generates briefs
      // only for these, not the post/stories/reels default
      formats: (d.plannedTypes && d.plannedTypes.length > 0) ? d.plannedTypes : ['post', 'stories', 'reels'],
    }))
    if (!briefDays.length) {
      toast.error('Нет данных плана прогрева для этой недели')
      return
    }
    const loadingToast = toast.loading('Составляю план недели — обычно 20-40 секунд. Не закрывай страницу.')
    try {
      const res = await fetch('/api/ai/generate-week-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: id, days: briefDays }),
      })
      const rawText = await res.text()
      if (!res.ok) {
        let errData: { error?: string; hint?: string } = {}
        try { errData = JSON.parse(rawText) } catch { /* ignore */ }
        const msg = errData.error || `Ошибка ${res.status}`
        toast.dismiss(loadingToast)
        if (errData.hint) {
          toast.error(msg, { description: errData.hint, duration: 6000 })
        } else {
          toast.error(msg)
        }
        return
      }
      let data: { days: Array<{ day: number; brief: Record<string, string> }> }
      try {
        data = JSON.parse(rawText)
      } catch {
        toast.dismiss(loadingToast)
        toast.error('AI вернул некорректный ответ, попробуй ещё раз')
        return
      }
      // Update themes in days state, then persist the week plan
      setDays(prev => {
        const next = prev.map(d => {
          const briefDay = data.days.find(b => b.day === d.day)
          if (!briefDay) return d
          // Respect the user's format choice — keep only briefs for the
          // formats they actually chose; do NOT re-add removed formats.
          const chosen = (d.plannedTypes && d.plannedTypes.length > 0)
            ? d.plannedTypes
            : (Object.keys(briefDay.brief) as ContentType[])
          const filteredBrief: Record<string, string> = {}
          for (const f of chosen) {
            if (briefDay.brief[f]) filteredBrief[f] = briefDay.brief[f]
          }
          const newTheme = Object.values(filteredBrief).join(' · ')
          return { ...d, theme: newTheme, plannedTypes: chosen, dayBriefs: filteredBrief }
        })
        void persistPlan(next)
        return next
      })
      toast.dismiss(loadingToast)
      toast.success('План недели готов и сохранён! Кликай на тип контента чтобы сгенерировать')
    } catch (e) {
      toast.dismiss(loadingToast)
      toast.error(e instanceof Error ? e.message : 'Ошибка')
    }
  }, [id, days, persistPlan])

  const handleExport = useCallback(async () => {
    if (!days || days.length === 0) {
      toast.error('Нечего экспортировать — план ещё не сформирован')
      return
    }
    const PHASE_RU: Record<string, string> = {
      awareness: 'Прогрев на нишу',
      trust:     'Прогрев на эксперта',
      desire:    'Прогрев на продукт',
      close:     'Отработка возражений',
    }
    const TYPE_RU: Record<string, string> = {
      post: 'Пост', carousel: 'Карусель', reels: 'Рилз', stories: 'Сторис',
      live: 'Эфир', webinar: 'Вебинар', email: 'Email',
    }

    const lines: string[] = []
    lines.push(`# Контент-план — Неделя ${week}`)
    if (planName) lines.push(`\n_${planName}_`)
    lines.push('')

    for (const d of days) {
      const phase = d.phase ? ` · ${PHASE_RU[d.phase] ?? d.phase}` : ''
      lines.push(`## ${d.dayOfWeek}, ${d.date}${phase}`)
      if (d.theme) lines.push(`\n${d.theme}`)
      if (d.plannedTypes && d.plannedTypes.length > 0) {
        lines.push(`\n**Форматы:** ${d.plannedTypes.map(t => TYPE_RU[t] ?? t).join(', ')}`)
      }
      if (d.dayBriefs && Object.keys(d.dayBriefs).length > 0) {
        lines.push('\n### Темы под форматы')
        for (const [t, brief] of Object.entries(d.dayBriefs)) {
          if (!brief) continue
          lines.push(`- **${TYPE_RU[t] ?? t}:** ${brief}`)
        }
      }
      if (d.items && d.items.length > 0) {
        lines.push('\n### Сгенерированный контент')
        for (const it of d.items) {
          lines.push(`\n#### ${TYPE_RU[it.content_type] ?? it.content_type}${it.title ? ` — ${it.title}` : ''}`)
          if (it.body_text) lines.push(it.body_text)
          if (it.cta) lines.push(`\n**CTA:** ${it.cta}`)
          if (it.hashtags && it.hashtags.length > 0) lines.push(`\n**Хэштеги:** ${it.hashtags.join(' ')}`)
        }
      }
      lines.push('\n---\n')
    }

    const md   = lines.join('\n')
    const blob = new Blob(['﻿' + md], { type: 'text/markdown;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    const safeName = (planName || 'content-plan').replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().slice(0, 60) || 'content-plan'
    a.href = url; a.download = `${safeName} — Неделя ${week}.md`; a.click()
    URL.revokeObjectURL(url)
    toast.success('Скачано')
  }, [days, week, planName])

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
    <div className="p-4 md:p-6 pb-28 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
          <Link href={`/projects/${id}`}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-foreground">Контент-план</h1>
          <p className="text-sm text-muted-foreground truncate">
            {(() => {
              // planName looks like "Прогрев 48 дней — ПРОДУКТ (старт 2026-05-18)"
              // Show just the product name + duration, not the whole technical string.
              const product = planName?.match(/—\s*(.+?)\s*\(старт/)?.[1]?.trim()
                ?? planName?.replace(/^Прогрев\s+\d+\s+дней\s*[—-]\s*/, '').replace(/\s*\(старт.*\)$/, '').trim()
              return product || 'Кликайте на тип контента, чтобы сгенерировать'
            })()}
            {totalDays ? ` · ${totalDays} дней` : ''}
          </p>
        </div>
        {!hasPlan && (
          <Link href={`/projects/${id}/strategy`} className="shrink-0">
            <Button size="sm" variant="outline" className="border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 text-xs gap-1.5 whitespace-nowrap">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              Создать стратегию
            </Button>
          </Link>
        )}
      </div>

      {/* Collapsible help — how to work with the content plan */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <button
          onClick={() => setShowHelp(v => !v)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-foreground hover:bg-secondary/40 transition-colors"
        >
          <span className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-primary shrink-0" />
            Как работать с контент-планом
          </span>
          {showHelp ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>
        {showHelp && (
          <div className="px-4 pb-4 pt-1 space-y-2 text-sm text-muted-foreground border-t border-border">
            <p>• Темы из плана прогрева уже расставлены по дням недели.</p>
            <p>• <span className="text-foreground font-medium">Шаг 1.</span> Выбери форматы для каждого дня (× убрать, + добавить Email/Лонгрид и т.д.), затем нажми <span className="text-foreground font-medium">«Сгенерировать план»</span> — AI распишет тему под каждый формат.</p>
            <p>• <span className="text-foreground font-medium">Шаг 2.</span> Нажми на формат (Пост / Сторис / Рилз) — AI сгенерирует готовый текст под его тему.</p>
            <p>• Сгенерированный контент помечается галочкой ✓ — нажми, чтобы открыть и отредактировать.</p>
            <p>• <span className="text-foreground font-medium">«AI-правка»</span> внизу — попроси AI поменять темы или структуру плана словами.</p>
            <p>• Переключай недели стрелками ‹ › вверху.</p>
          </div>
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
          onGenerateWeekBrief={handleGenerateWeekBrief}
          onExport={handleExport}
          onRemoveType={handleRemoveType}
          onAddType={handleAddType}
          loading={false}
        />
      )}

      {/* AI Edit Chat — edit day themes in the warmup plan */}
      {hasPlan && warmupPlanId && (
        <AiEditChat
          projectId={id}
          contextType="warmup_plan"
          contextId={warmupPlanId}
          contextLabel={planName ?? 'Контент-план'}
          // Tell the editor which week is on screen + the weekday→day mapping, so
          // "change Wednesday's stories" edits the right day in THIS week.
          weekContext={{
            week,
            days: days.map(d => ({
              day: d.day, date: d.date, dayOfWeek: d.dayOfWeek, phase: d.phase, briefs: d.dayBriefs,
            })),
          }}
          onPlanUpdate={() => {
            // Reload the current week to reflect updated day themes
            loadPlanData(week)
          }}
        />
      )}
    </div>
  )
}
