import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildFallbackDays, buildDaysFromWarmupPlan, calendarWeeksCount, calendarWeekDates,
  planDayForDate, mondayOf, startOffsetInWeek,
} from '@/lib/contentPlanDays'
import type { WarmupPlanData } from '@/types'

const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, 'utf8')
// 10.09, Августа (голосом): «он недели прогрева считает со среды по среду —
// как-то не очень. Чтобы если созвонились в четверг, у неё первая неделя:
// понедельник, вторник, среда пустые, в четверг пошли».
const THU = new Date('2026-09-10T00:00:00') // четверг
const MON = new Date('2026-09-07T00:00:00')

describe('недели контент-плана — календарные (ПН…ВС)', () => {
  it('старт в четверг: первая неделя начинается с понедельника, три дня пустые', () => {
    expect(startOffsetInWeek(THU)).toBe(3)
    expect(mondayOf(THU).getDate()).toBe(7)
    const week1 = calendarWeekDates(1, THU)
    expect(week1).toHaveLength(7)
    expect(week1[0].getDay()).toBe(1)  // ПН
    expect(week1[6].getDay()).toBe(0)  // ВС
    expect(planDayForDate(week1[0], THU, 45)).toBeNull() // ПН до старта
    expect(planDayForDate(week1[2], THU, 45)).toBeNull() // СР до старта
    expect(planDayForDate(week1[3], THU, 45)).toBe(1)    // ЧТ — день 1
    expect(planDayForDate(week1[6], THU, 45)).toBe(4)    // ВС — день 4
  })
  it('старт в понедельник: неделя ровная, пустых дней нет', () => {
    const w1 = calendarWeekDates(1, MON)
    expect(planDayForDate(w1[0], MON, 45)).toBe(1)
    expect(planDayForDate(w1[6], MON, 45)).toBe(7)
    expect(calendarWeeksCount(45, MON)).toBe(7)
  })
  it('план со старта не в понедельник занимает на неделю больше', () => {
    expect(calendarWeeksCount(45, THU)).toBe(7) // 3 + 45 = 48 → 7 недель
    expect(calendarWeeksCount(28, THU)).toBe(5) // 3 + 28 = 31 → 5 недель
    expect(calendarWeeksCount(28, MON)).toBe(4)
  })
  it('вторая неделя продолжает календарь без разрывов', () => {
    const w2 = calendarWeekDates(2, THU)
    expect(w2[0].getDay()).toBe(1)
    expect(planDayForDate(w2[0], THU, 45)).toBe(5) // ПН = день 5 плана
  })
})

describe('сетка недели: пустые ячейки до старта и после конца', () => {
  const plan = {
    warmup_plan: {
      phases: [{
        phase: 'awareness',
        daily_plan: Array.from({ length: 10 }, (_, i) => ({ day: i + 1, meaning: `Тема ${i + 1}`, format: ['post'] })),
      }],
    },
  } as unknown as WarmupPlanData

  it('первая неделя: 7 ячеек, до старта — outsidePlan без форматов', () => {
    const days = buildDaysFromWarmupPlan(plan, 1, 1, THU)
    expect(days).toHaveLength(7)
    expect(days.slice(0, 3).every(d => d.outsidePlan)).toBe(true)
    expect(days.slice(0, 3).every(d => d.plannedTypes.length === 0)).toBe(true)
    expect(days[0].theme).toBe('До старта прогрева')
    expect(days[3].outsidePlan).toBeUndefined()
    expect(days[3].day).toBe(1)
    expect(days[3].dayOfWeek).toBe('ЧТ')
    expect(days[3].theme).toBe('Тема 1')
  })
  it('после конца плана ячейки тоже пустые, но с другой подписью', () => {
    const days = buildDaysFromWarmupPlan(plan, 2, 1, THU) // дни 5..10 + хвост
    const tail = days.filter(d => d.outsidePlan)
    expect(tail.length).toBeGreaterThan(0)
    expect(tail.every(d => d.theme === 'План завершён')).toBe(true)
  })
  it('запасная сетка (без плана прогрева) — та же календарная логика', () => {
    const days = buildFallbackDays(1, 45, THU)
    expect(days).toHaveLength(7)
    expect(days.slice(0, 3).every(d => d.outsidePlan)).toBe(true)
    expect(days[3].day).toBe(1)
  })
})

describe('страница и сетка используют календарные недели', () => {
  it('всего недель считается по календарю, а не duration/7', () => {
    const page = read('app/(dashboard)/projects/[id]/content-plan/page.tsx')
    expect(page).toContain('calendarWeeksCount(duration, planAnchorDate(startDateStr')
    expect(page).not.toMatch(/setTotalWeeks\(Math\.ceil\(duration \/ 7\)\)/)
  })
  it('пустой день рисуется без кнопок генерации, у недели виден диапазон дат', () => {
    const grid = read('components/content/ContentPlanGrid.tsx')
    expect(grid).toContain('if (day.outsidePlan)')
    expect(grid).toContain('empty-${day.date}')
    expect(grid).toContain('{days[0].date.slice(0, 5)} – {days[days.length - 1].date.slice(0, 5)}')
  })
  it('в генерацию плана недели пустые дни не уходят', () => {
    const page = read('app/(dashboard)/projects/[id]/content-plan/page.tsx')
    expect(page).toContain('days.filter(d => d.phase && d.plannedTypes && d.plannedTypes.length > 0)')
  })
})
