import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { isReturningCustomer } from '@/lib/billing/planState'
import { parseTopupPayment } from '@/lib/billing/prodamus'

// Мандат Матвея 06.09: (1) возвращающийся платит сразу, демо — только новым;
// (2) единицы и кап — месяц ОТ ОПЛАТЫ, не календарный; (3) исчерпал раньше —
// может докупить объём своего тарифа, не ломая рекуррент.
const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, 'utf8')

describe('демо только новым', () => {
  it('возвращающийся: закрыт за неоплату / был период / была подписка', () => {
    expect(isReturningCustomer({ subscription_status: 'view_only', current_period_end: '2026-08-29', provider_subscription_id: null, payment_provider: null })).toBe(true)
    expect(isReturningCustomer({ subscription_status: 'trialing', current_period_end: null, provider_subscription_id: null, payment_provider: null })).toBe(false) // новый после регистрации
    expect(isReturningCustomer({ subscription_status: 'canceled', current_period_end: null, provider_subscription_id: 'sub_x', payment_provider: 'stripe' })).toBe(true)
  })
  it('Stripe: триал только если !returning; Продамус: возвращающемуся — ссылка без демо или предупреждение', () => {
    expect(read('app/api/billing/checkout/route.ts')).toContain("plan === 'solo' && !returning && soloTrialDays() > 0")
    const pr = read('app/api/billing/prodamus/checkout/route.ts')
    expect(pr).toContain('prodamusLinkNoDemo(plan as PaidPlan)')
    // решение 06.09: без продукта без демо возвращающемуся НЕ продаём (503), а не даём демо
    expect(pr).toContain("{ error: 'nodemo_not_configured' }, { status: 503 }")
    expect(read('app/(dashboard)/pricing/page.tsx')).toContain('ruReady')
    const pc = read('components/pricing/PricingClient.tsx')
    expect(pc).toContain('Оплата картой РФ подключается')
    expect(pc).toContain('Докупка картой РФ подключается')
  })
})

describe('единицы по биллинговому периоду', () => {
  it('оба вебхука начинают период при оплате; RPC 047 равняется на current_period_end', () => {
    expect(read('app/api/billing/stripe/webhook/route.ts')).toContain('startBillingPeriod(admin, resolvedUserId, new Date(newEndMs))')
    expect(read('app/api/billing/prodamus/webhook/route.ts')).toContain('startBillingPeriod(admin, userId, periodEnd)')
    const sql = read('supabase/migrations/047_billing_period_units.sql')
    expect(sql).toContain('period_started_at')
    expect(sql).toContain('v_next_reset := v_profile.current_period_end')
    expect(read('lib/billing/period.ts')).toContain('generations_reset_at: periodEnd.toISOString()')
    expect(read('lib/billing/costCap.ts')).toContain("select('period_started_at')")
  })
})

describe('докупка объёма раньше срока', () => {
  it('роут: только на действующей подписке, Stripe mode=payment с metadata topup, Продамус — ссылка из env', () => {
    const r = read('app/api/billing/topup/route.ts')
    expect(r).toContain("mode: 'payment'")
    expect(r).toContain("type: 'topup'")
    expect(r).toContain('hasActivePaidSubscription(')
    expect(r).toContain('prodamusTopupLink(plan)')
  })
  it('вебхуки выдают объём: Stripe по metadata, Продамус по order_id/названию товара', () => {
    expect(read('app/api/billing/stripe/webhook/route.ts')).toContain("session.mode === 'payment' && session.metadata?.type === 'topup'")
    expect(read('app/api/billing/prodamus/webhook/route.ts')).toContain('parseTopupPayment(data')
    expect(parseTopupPayment({ order_id: '6405276f-c82b-4ee9-b346-69e2bde9ff02.topup-solo.123' })).toEqual({ userId: '6405276f-c82b-4ee9-b346-69e2bde9ff02', plan: 'solo' })
    expect(parseTopupPayment({ products: [{ name: 'AVA · докупка Про' }] })).toEqual({ plan: 'pro' })
    expect(parseTopupPayment({ products: [{ name: 'Курс Августы' }] })).toBeNull()
  })
  it('grantTopup: единицы бонусом + ресурс до конца периода + строка в ленте', () => {
    const t = read('lib/billing/topup.ts')
    expect(t).toContain("rpc('add_bonus_generations'")
    expect(t).toContain('budget_boost_usd')
    expect(t).toContain("recordUnits(userId, 'topup', -units")
  })
  it('витрина: на действующем тарифе есть «Докупить ещё N единиц»', () => {
    const pc = read('components/pricing/PricingClient.tsx')
    expect(pc).toContain('Докупить ещё ${cfg.generations} единиц')
    expect(pc).toContain("fetch('/api/billing/topup'")
  })
})
