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
  /** Календарный день ВНЕ плана: до старта прогрева или после его конца.
      Показывается пустой ячейкой, чтобы неделя читалась как календарная. */
  outsidePlan?: boolean
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

// ── Календарные недели (10.09, Августа) ──────────────────────────────────────
// Было: «неделя N» = дни N*7 подряд от старта. Старт в четверг → первая неделя
// шла «с четверга по среду», и в контент-плане это читалось как каша: «он
// недели прогрева считает со среды по среду, как-то не очень».
// Стало: неделя — календарная (ПН…ВС). Дни до старта и после конца плана
// остаются пустыми ячейками, как в обычном календаре.
const DAY_MS = 24 * 3600 * 1000

/** Понедельник той недели, в которую попадает дата. */
export function mondayOf(d: Date): Date {
  const m = new Date(d)
  m.setHours(0, 0, 0, 0)
  const shift = (m.getDay() + 6) % 7 // ПН=0 … ВС=6
  m.setDate(m.getDate() - shift)
  return m
}

/** Сколько дней недели «съедает» старт: план с четверга оставляет ПН-СР пустыми. */
export function startOffsetInWeek(anchor: Date): number {
  return (anchor.getDay() + 6) % 7
}

/** Сколько КАЛЕНДАРНЫХ недель занимает план (первая и последняя могут быть неполными). */
export function calendarWeeksCount(totalDays: number, anchor?: Date): number {
  const a = anchor ?? new Date()
  return Math.max(1, Math.ceil((startOffsetInWeek(a) + Math.max(1, totalDays)) / 7))
}

/** Календарные даты недели N (1-based): всегда 7 дней, ПН…ВС. */
export function calendarWeekDates(weekNumber: number, anchor: Date): Date[] {
  const start = mondayOf(anchor)
  start.setDate(start.getDate() + (weekNumber - 1) * 7)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    return d
  })
}

/** Номер дня плана для даты (1-based); вне плана — null. */
export function planDayForDate(date: Date, anchor: Date, totalDays: number): number | null {
  const a = new Date(anchor); a.setHours(0, 0, 0, 0)
  const d = new Date(date); d.setHours(0, 0, 0, 0)
  const day = Math.round((d.getTime() - a.getTime()) / DAY_MS) + 1
  return day >= 1 && day <= totalDays ? day : null
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
      // Выходной день (ставится AI-правкой: «сделай субботу выходной» —
      // Марина, 25.08): без форматов и генераций, с честной подписью.
      const rest = dayData.rest === true
      // `formats` = user's saved format choice; `format` = legacy plan field
      const savedFmt = (dayData.formats as ContentType[]) || (dayData.format as ContentType[]) || []
      const briefs = dayData.briefs as Record<string, string> | undefined
      if (!rest && briefs && Object.keys(briefs).length > 0) savedBriefs[dayPlan.day] = briefs
      allDays.push({
        day: dayPlan.day,
        phase: phaseData.phase as WarmupPhase,
        // An empty saved `formats` is a deliberate "user removed all" only if
        // briefs exist for that day; otherwise fall back to defaults.
        format: rest ? [] : (savedFmt.length > 0 ? savedFmt : (briefs ? [] : DEFAULT_FORMATS)),
        theme: rest
          ? ((dayData.meaning as string) || 'Выходной — без публикаций')
          : ((dayData.meaning as string) || (dayData.theme as string) || ''),
      })
    }
  }

  allDays.sort((a, b) => a.day - b.day)
  void startDay

  // КАЛЕНДАРНАЯ неделя ПН…ВС: берём 7 дат недели и подставляем в них дни плана.
  // Дни до старта (и после конца) остаются пустыми ячейками — это и просила
  // Августа: «первая неделя прогрева — понедельник, вторник, среда пустые, в
  // четверг пошли».
  const anchor = baseDate ?? new Date()
  const byDay = new Map(allDays.map((d) => [d.day, d]))
  const totalDays = allDays.length ? allDays[allDays.length - 1].day : 0

  return calendarWeekDates(weekNumber, anchor).map((date) => {
    const { date: dateStr, dayOfWeek } = fmtDdMmYyyy(date)
    const dayNum = planDayForDate(date, anchor, totalDays)
    const d = dayNum !== null ? byDay.get(dayNum) : undefined
    if (!d) {
      return {
        day: dayNum ?? 0,
        date: dateStr,
        dayOfWeek,
        items: [],
        plannedTypes: [],
        phase: 'awareness' as WarmupPhase,
        outsidePlan: true,
        theme: date < mondayOf(anchor) || date.getTime() < new Date(anchor).setHours(0, 0, 0, 0)
          ? 'До старта прогрева' : 'План завершён',
      }
    }
    return {
      day: d.day,
      date: dateStr,
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

  // Та же календарная сетка, что и у плана (см. buildDaysFromWarmupPlan).
  const anchor = baseDate ?? new Date()
  return calendarWeekDates(weekNumber, anchor).map((d) => {
    const { date, dayOfWeek } = fmtDdMmYyyy(d)
    const dayNum = planDayForDate(d, anchor, totalDays)
    if (dayNum === null) {
      return {
        day: 0, date, dayOfWeek, items: [], plannedTypes: [], phase: 'awareness' as WarmupPhase, outsidePlan: true,
        theme: d.getTime() < new Date(anchor).setHours(0, 0, 0, 0) ? 'До старта прогрева' : 'План завершён',
      }
    }
    const phaseIndex = Math.floor(((dayNum - 1) / totalDays) * 4)
    return {
      day: dayNum,
      date,
      dayOfWeek,
      items: [],
      plannedTypes: types[(dayNum - 1) % 7] as ContentType[],
      phase: phases[Math.min(phaseIndex, 3)],
    }
  })
}
