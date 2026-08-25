import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildDaysFromWarmupPlan } from '../../lib/contentPlanDays'
import type { WarmupPlanData } from '../../types'

// Стражи списка Марины (25.08):
//  1) «Оформить» терял утверждённый сценарий при выходе — теперь сценарий
//     авто-сохраняется в «Готовое» (сервер) прямо при клике;
//  2) «хочу публиковаться 5 дней в неделю» — AI-правка умеет выходные
//     (rest: true) и перенос тем; выходной не получает форматы и брифы;
//  3) кнопка правки плана называется «Изменить план» и подсказана примерами.

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('выходные дни в контент-плане', () => {
  it('AI-правка: контракт rest/formats задокументирован и применяется', () => {
    const r = read('app/api/ai/edit/route.ts')
    expect(r).toContain('"rest": true')
    expect(r).toContain('change.rest === true')
    expect(r).toContain("change.rest === false")
    expect(r).toContain('VALID_FORMATS')
  })
  it('сетка: rest-день без форматов и брифов, с честной подписью', () => {
    const plan = {
      warmup_plan: {
        phases: [{
          phase: 'niche', label: 'x',
          daily_plan: [
            { day: 1, meaning: 'тема 1' },
            { day: 2, meaning: 'Выходной', rest: true, briefs: { post: 'старый бриф' } },
            { day: 3, rest: true },
          ],
        }],
      },
    } as unknown as WarmupPlanData
    const days = buildDaysFromWarmupPlan(plan, 1, 1, new Date('2026-08-24T00:00:00'))
    expect(days[0].plannedTypes.length).toBeGreaterThan(0)
    expect(days[1]).toMatchObject({ plannedTypes: [], theme: 'Выходной' })
    expect(days[1].dayBriefs).toBeUndefined() // брифы выходного не всплывают
    expect(days[2]).toMatchObject({ plannedTypes: [], theme: 'Выходной — без публикаций' })
  })
  it('генерация недели не шлёт дни без форматов (выходные/опустошённые)', () => {
    const page = read('app/(dashboard)/projects/[id]/content-plan/page.tsx')
    expect(page).toContain('d.plannedTypes && d.plannedTypes.length > 0).map')
  })
})

describe('кнопка правки плана очевидна', () => {
  it('называется «Изменить план» и есть подсказка с примерами (в т.ч. выходные)', () => {
    const page = read('app/(dashboard)/projects/[id]/content-plan/page.tsx')
    expect(page).toContain('Изменить план')
    expect(page).toContain('сделай субботу и воскресенье выходными')
    expect(page).not.toMatch(/>\s*AI-правка\s*</) // старое имя кнопки не вернулось
  })
})

describe('«Оформить» не теряет сценарий (авто-сохранение в «Готовое»)', () => {
  it('хелпер существует и защищён от дублей', () => {
    const h = read('lib/studioHandoff.ts')
    expect(h).toContain('export function autoSaveScriptToLibrary')
    expect(h).toContain('autoSavedScripts')
  })
  it('оба чата зовут авто-сохранение ПЕРЕД хендоффом', () => {
    for (const p of ['app/(dashboard)/projects/[id]/assistant/page.tsx', 'app/(dashboard)/create/page.tsx']) {
      const src = read(p)
      const auto = src.indexOf('autoSaveScriptToLibrary(')
      const handoff = src.indexOf('setStudioHandoff(', auto)
      expect(auto, p).toBeGreaterThan(-1)
      expect(handoff, p).toBeGreaterThan(auto)
    }
  })
})
