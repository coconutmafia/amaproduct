import type { ContentItem, ContentType, WarmupPhase, WarmupPlanData } from '@/types'

// Построение сетки дней контент-плана (вынесено из content-plan/page.tsx
// 25.08 — жалоба Даши Шитовой «у тебя даты поехали»: вечнозелёный план без
// даты старта якорился на «сегодня» (даты уезжали каждый день), а метка дня
// недели была ПОЗИЦИОННОЙ — день 1 всегда «ПН», даже если по календарю
// вторник. Теперь: день недели считается ИЗ РЕАЛЬНОЙ ДАТЫ, а якорь плана
// стабилен (start_date, иначе день создания плана — см. planAnchorDate).

export interface DayData {
  day: number
  date: string
  dayOfWeek: string
  items: ContentItem[]
  plannedTypes: ContentType[]
  phase: WarmupPhase
  theme?: string
  dayBriefs?: Record<string, string>
}

// getDay(): 0 = воскресенье
export const WEEKDAY_RU = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'] as const

function fmtDdMmYyyy(d: Date): { date: string; dayOfWeek: string } {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return { date: `${dd}.${mm}.${yyyy}`, dayOfWeek: WEEKDAY_RU[d.getDay()] }
}

// Стабильный якорь плана: явная дата старта, иначе — ДЕНЬ СОЗДАНИЯ плана
// (не «сегодня»: сегодня наступает заново каждые сутки, и весь план ехал
// вместе с ним — вчера день 1 был 24.08, сегодня уже 25.08).
export function planAnchorDate(startDateStr: string | null | undefined, createdAt: string | null | undefined): Date | undefined {
  if (startDateStr) return new Date(startDateStr + 'T00:00:00')
  if (createdAt) {
    const c = new Date(createdAt)
    if (!Number.isNaN(c.getTime())) { c.setHours(0, 0, 0, 0); return c }
  }
  return undefined
}

export function buildDaysFromWarmupPlan(planData: WarmupPlanData, weekNumber: number, startDay: number, baseDate?: Date): DayData[] {
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

  return weekDays.map((d) => {
    const base = baseDate ? new Date(baseDate) : new Date()
    base.setDate(base.getDate() + d.day - 1)
    const { date, dayOfWeek } = fmtDdMmYyyy(base)

    return {
      day: d.day,
      date,
      dayOfWeek,
      items: [],
      plannedTypes: d.format,
      phase: d.phase,
      theme: d.theme,
      dayBriefs: savedBriefs[d.day],
    }
  })
}

export function buildFallbackDays(weekNumber: number, totalDays: number, baseDate?: Date): DayData[] {
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
    const { date, dayOfWeek } = fmtDdMmYyyy(d)
    return {
      day: dayNum,
      date,
      dayOfWeek,
      items: [],
      plannedTypes: types[i % 7] as ContentType[],
      phase: phases[Math.min(phaseIndex, 3)],
    }
  }).filter(Boolean) as DayData[]
}
