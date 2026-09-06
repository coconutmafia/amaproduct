import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { isCurrentPlan, hasActivePaidSubscription } from '@/lib/billing/planState'

// Инцидент 06.09 (видео, Виктория Абертасова): tier=solo, status=view_only,
// платёжки нет — витрина считала Соло «текущим» и выключала кнопку: человек
// хотел заплатить и не мог. Свой тариф без действующей подписки — покупаем.
describe('текущий план = только действующая подписка', () => {
  it('view_only / пауза / ручной триал без платёжки — тариф покупаемый', () => {
    expect(isCurrentPlan('solo', 'solo', 'view_only', null)).toBe(false)
    expect(isCurrentPlan('solo', 'solo', 'paused', null)).toBe(false)
    expect(isCurrentPlan('solo', 'solo', 'trialing', null)).toBe(false)   // ручной триал (Даша)
    expect(isCurrentPlan('solo', 'trial', 'trialing', null)).toBe(false)
  })
  it('active / trialing с платёжкой — действительно текущий', () => {
    expect(isCurrentPlan('solo', 'solo', 'active', 'prodamus')).toBe(true)
    expect(isCurrentPlan('solo', 'solo', 'trialing', 'stripe')).toBe(true)  // 60-дневный триал Stripe
    expect(hasActivePaidSubscription('active', 'stripe')).toBe(true)
    expect(hasActivePaidSubscription('active', null)).toBe(false)
  })
  it('витрина и окно лимита используют это правило, а не равенство тиров', () => {
    const client = readFileSync(`${process.cwd()}/components/pricing/PricingClient.tsx`, 'utf8')
    expect(client).toContain('isCurrentPlan(key, currentPlan, subscriptionStatus, paymentProvider)')
    expect(client).not.toContain('const isCurrent = key === currentPlan')
    expect(client).toContain('Возобновить')
    const page = readFileSync(`${process.cwd()}/app/(dashboard)/pricing/page.tsx`, 'utf8')
    expect(page).toContain('subscriptionStatus=')
    const dlg = readFileSync(`${process.cwd()}/components/billing/UpgradeDialog.tsx`, 'utf8')
    expect(dlg).toContain('hasActivePaidSubscription(subscriptionStatus, paymentProvider)')
    const layout = readFileSync(`${process.cwd()}/app/(dashboard)/layout.tsx`, 'utf8')
    expect(layout).toContain('subscriptionStatus=')
  })
})
