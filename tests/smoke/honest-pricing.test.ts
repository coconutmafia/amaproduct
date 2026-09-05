import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { PLAN_CONFIG, PAID_PLANS, UNIT_COST_USD, planCapacity, planCapacityLine } from '@/lib/generations-config'
import { tierBudgetUsd } from '@/lib/billing/costCap'

// Честная витрина (мандат Матвея 05.09, кейс Даши «Про — бесконечная
// генерация»): тариф обещает ровно то, что даёт кап себестоимости; никаких
// «безлимитов» и фич «(при запуске)»; объёмы объясняются в понятных величинах,
// которые считаются из UNIT_COSTS, а не хардкодятся.
const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, 'utf8')

describe('честная витрина тарифов', () => {
  it('объём единиц каждого платного тарифа не больше, чем даёт кап себестоимости', () => {
    for (const plan of PAID_PLANS) {
      const cfg = PLAN_CONFIG[plan]
      const capUnits = tierBudgetUsd(plan) / UNIT_COST_USD
      expect(cfg.unlimited, `${plan}: «безлимит» при капе — обещание, которого нет`).toBe(false)
      expect(cfg.generations, `${plan}: ${cfg.generations} ед. > кап ${capUnits.toFixed(0)}`).toBeLessThanOrEqual(Math.ceil(capUnits))
    }
  })

  it('в витрине нет «безлимита» и обещаний «при запуске»', () => {
    const texts = Object.values(PLAN_CONFIG).flatMap(c => c.features).join('\n')
    expect(texts).not.toMatch(/безлимит/i)
    expect(texts).not.toMatch(/при запуске/i)
    const landing = read('components/landing/LandingPage.tsx')
    expect(landing).not.toMatch(/Безлимит генераций/)
    expect(landing).not.toMatch(/\(при запуске\)/)
  })

  it('понятные величины считаются из UNIT_COSTS и показаны на тарифах и в окне лимита', () => {
    const c = planCapacity(300)
    expect(c.posts).toBe(150)
    expect(c.transcribeHours).toBe(50)
    expect(planCapacityLine(300)).toContain('150 постов')
    expect(read('components/pricing/PricingClient.tsx')).toContain('planCapacityLine(cfg.generations)')
    expect(read('components/billing/UpgradeDialog.tsx')).toContain('planCapacityLine(cfg.generations)')
  })

  it('лимиты в БД (миграция 046) синхронны с честными объёмами', () => {
    const sql = read('supabase/migrations/046_honest_tier_limits.sql')
    expect(sql).toContain("WHEN 'pro'      THEN 900")
    expect(sql).toContain("WHEN 'producer' THEN 1800")
  })
})
