import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PLAN_CONFIG, PAID_PLANS, VISIBLE_PAID_PLANS, STARTER_VISIBLE, nextPlan,
} from '../../lib/generations-config'

// Стражи тарифной лестницы (решение Матвея 29.08: «каждый тариф продаёт
// следующий» + тариф «Старт» как ступень после бесплатной диагностики).
//
// Числа Старта посчитаны от себестоимости (отчёт 29.08): полный базовый путь
// юзера ≈ 75 юнитов / $8-9, поэтому 100 юнитов за $25 — минимум, при котором
// юзер доходит до конца сервиса, а маржа держится ≥50% даже в стрессе.
//
// Старт скрыт до NEXT_PUBLIC_STARTER_TIER=1: включать только после миграции
// 040 и продукта в ЛК Продамуса на 2500₽ («обе платёжки одинаково»). Биллинг
// при этом работает с ПОЛНЫМ PAID_PLANS — оплата до включения витрины всё
// равно корректно выдаст тариф.

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('тариф «Старт»', () => {
  it('конфиг: $25 / 2500₽ / 100 юнитов / 1 проект (числа из расчёта 29.08)', () => {
    expect(PLAN_CONFIG.starter).toMatchObject({
      price: 25, priceRub: 2500, generations: 100, projects: 1, paid: true, unlimited: false,
    })
  })
  it('биллинг знает Старт целиком: Stripe lookup, Продамус env, nameMap вебхука', () => {
    expect(read('lib/billing/stripe.ts')).toContain("starter: 'ama_starter_monthly'")
    expect(read('lib/billing/prodamus.ts')).toContain('PRODAMUS_LINK_STARTER')
    expect(read('lib/billing/prodamus.ts')).toContain('PRODAMUS_SUB_STARTER')
    expect(read('app/api/billing/prodamus/webhook/route.ts')).toContain("'старт': 'starter'")
  })
  it('цены Старта уникальны — вебхук Продамуса резолвит тариф по сумме без коллизий', () => {
    const rubs = PAID_PLANS.map((p) => PLAN_CONFIG[p].priceRub)
    expect(new Set(rubs).size).toBe(rubs.length)
  })
  it('витрина за флагом: без NEXT_PUBLIC_STARTER_TIER=1 Старт скрыт, биллинг — нет', () => {
    // В тестовом окружении флаг не задан — проверяем закрытое состояние.
    expect(STARTER_VISIBLE).toBe(false)
    expect(VISIBLE_PAID_PLANS).not.toContain('starter')
    expect(PAID_PLANS).toContain('starter')
    // UI ходит по VISIBLE_PAID_PLANS, биллинг-роуты — по PAID_PLANS
    expect(read('components/pricing/PricingClient.tsx')).toContain('VISIBLE_PAID_PLANS.map')
    expect(read('components/billing/UpgradeDialog.tsx')).toContain('VISIBLE_PAID_PLANS.map')
    expect(read('app/api/billing/checkout/route.ts')).toContain('PAID_PLANS.includes')
    expect(read('components/landing/LandingPage.tsx')).toContain('STARTER_VISIBLE')
  })
  it('у Старта в Stripe НЕТ триала (60 дней — обещание Августы для Соло)', () => {
    const checkout = read('app/api/billing/checkout/route.ts')
    expect(checkout).toMatch(/plan === 'solo' && soloTrialDays\(\)/)
    expect(checkout).not.toMatch(/plan === 'starter'.*trial/)
  })
})

describe('лестница апгрейда: каждый тариф продаёт следующий', () => {
  it('nextPlan идёт по ступеням и заканчивается на продюсере', () => {
    expect(nextPlan('trial')).toBe('solo')
    expect(nextPlan('starter')).toBe('solo')
    expect(nextPlan('solo')).toBe('pro')
    expect(nextPlan('pro')).toBe('producer')
    expect(nextPlan('producer')).toBeNull()
  })
  it('полоса юнитов на тарифах при ≥70% показывает следующую ступень', () => {
    const pc = read('components/pricing/PricingClient.tsx')
    expect(pc).toContain('monthlyPct >= 70 && next')
    expect(pc).toContain('nextPlan(currentPlan)')
  })
  it('диалог лимита подсвечивает следующую ступень юзера («Твой следующий шаг»)', () => {
    const ud = read('components/billing/UpgradeDialog.tsx')
    expect(ud).toContain("(currentPlan && nextPlan(currentPlan)) || 'solo'")
    expect(ud).toContain('Твой следующий шаг')
    // layout передаёт текущий тариф — иначе диалог всегда герой-Соло
    expect(read('app/(dashboard)/layout.tsx')).toContain('UpgradeDialogHost currentPlan=')
  })
})
