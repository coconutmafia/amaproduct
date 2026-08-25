import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildDaysFromWarmupPlan, buildFallbackDays, planAnchorDate } from '../../lib/contentPlanDays'
import type { WarmupPlanData } from '../../types'

// Страж жалобы Даши Шитовой (25.08.2026, чат «Ошибки»): «у тебя даты поехали…
// почему вторник 26 августа, сегодня вторник 25». Две причины, обе с первого
// коммита: (1) метка дня недели была ПОЗИЦИОННОЙ — день 1 всегда «ПН», даже
// если по календарю вторник; (2) вечнозелёный план без даты старта якорился
// на «сегодня» — все даты уезжали на день вперёд каждые сутки.

const plan = (days: number): WarmupPlanData => ({
  warmup_plan: {
    phases: [{
      phase: 'niche', label: 'x',
      daily_plan: Array.from({ length: days }, (_, i) => ({ day: i + 1, meaning: `смысл ${i + 1}` })),
    }],
  },
} as unknown as WarmupPlanData)

describe('дни недели считаются из РЕАЛЬНОЙ даты (не позиционно)', () => {
  it('план со стартом во вторник 25.08.2026: день 1 = ВТ, день 2 = СР', () => {
    // 2026-08-25 — вторник (день жалобы)
    const days = buildDaysFromWarmupPlan(plan(14), 1, 1, new Date('2026-08-25T00:00:00'))
    expect(days[0]).toMatchObject({ day: 1, date: '25.08.2026', dayOfWeek: 'ВТ' })
    expect(days[1]).toMatchObject({ day: 2, date: '26.08.2026', dayOfWeek: 'СР' })
    expect(days[6]).toMatchObject({ day: 7, date: '31.08.2026', dayOfWeek: 'ПН' })
  })
  it('вторая неделя продолжает календарь', () => {
    const days = buildDaysFromWarmupPlan(plan(14), 2, 1, new Date('2026-08-25T00:00:00'))
    expect(days[0]).toMatchObject({ day: 8, date: '01.09.2026', dayOfWeek: 'ВТ' })
  })
  it('фолбэк-сетка тоже честная: старт в понедельник 24.08 → ПН..ВС', () => {
    const days = buildFallbackDays(1, 45, new Date('2026-08-24T00:00:00'))
    expect(days[0]).toMatchObject({ date: '24.08.2026', dayOfWeek: 'ПН' })
    expect(days[6]).toMatchObject({ date: '30.08.2026', dayOfWeek: 'ВС' })
  })
})

describe('якорь плана стабилен (даты не едут каждый день)', () => {
  it('есть start_date → он и якорь', () => {
    const d = planAnchorDate('2026-08-10', '2026-08-07T15:46:44.607Z')!
    expect(d.getFullYear()).toBe(2026); expect(d.getMonth()).toBe(7); expect(d.getDate()).toBe(10)
  })
  it('нет start_date → якорь = день создания плана, полночь', () => {
    const d = planAnchorDate(null, '2026-06-07T19:26:00.022Z')!
    expect(d.getDate()).toBeGreaterThanOrEqual(7) // локальная дата момента создания
    expect(d.getHours()).toBe(0)
  })
  it('совсем ничего → undefined (заглушка без плана может жить от сегодня)', () => {
    expect(planAnchorDate(null, null)).toBeUndefined()
  })
})

describe('исходники: класс не возвращается', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  it('в построителях дней нет позиционных меток недели', () => {
    const lib = read('lib/contentPlanDays.ts')
    expect(lib).toContain('getDay()')
    expect(lib).not.toMatch(/DAYS_OF_WEEK\[i\]|DAYS_OF_WEEK\[\(absDay/)
    const page = read('app/(dashboard)/projects/[id]/content-plan/page.tsx')
    expect(page).not.toContain("['ПН', 'ВТ'") // локальной копии больше нет
    expect(page).toContain('planAnchorDate(') // стабильный якорь подключён
  })
  it('мастер всегда пишет meta.start_date (вечнозелёный — день одобрения, локальная дата)', () => {
    const w = read('components/strategy/WarmupWizard.tsx')
    expect(w).not.toMatch(/start_date:\s*startDate\s*\|\|\s*null/)
    expect(w).toMatch(/start_date:\s*startDate\s*\|\|/)
    // локальные компоненты даты, не toISOString (UTC-срез — класс tz-дат)
    expect(w).toMatch(/getFullYear\(\)[\s\S]{0,120}getMonth\(\)[\s\S]{0,120}getDate\(\)/)
  })
})
