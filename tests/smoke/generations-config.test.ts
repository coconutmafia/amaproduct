import { describe, it, expect } from 'vitest'
import { PLAN_CONFIG, PAID_PLANS, TRIAL_DAYS } from '@/lib/generations-config'

// Billing single-source-of-truth sanity. Prices/limits here drive Stripe
// ensurePrice, the Продамус amount-escalation guard, and the trial gate —
// an accidental edit must not slip through.

describe('plan config', () => {
  it('has the four approved tiers', () => {
    for (const t of ['trial', 'solo', 'pro', 'producer']) {
      expect(PLAN_CONFIG, `missing tier ${t}`).toHaveProperty(t)
    }
    expect(PAID_PLANS).toEqual(['solo', 'pro', 'producer'])
  })

  it('approved prices (PRICING.md) — the Продамус anti-escalation guard depends on priceRub', () => {
    expect(PLAN_CONFIG.solo.priceRub).toBe(4900)
    expect(PLAN_CONFIG.pro.priceRub).toBe(14900)
    expect(PLAN_CONFIG.producer.priceRub).toBe(29900)
    expect(PLAN_CONFIG.solo.price).toBe(49)
    expect(PLAN_CONFIG.producer.price).toBe(299)
    // producer must cost more than solo, else the escalation guard inverts
    expect(PLAN_CONFIG.producer.priceRub).toBeGreaterThan(PLAN_CONFIG.solo.priceRub)
  })

  it('trial is 60 days', () => {
    expect(TRIAL_DAYS).toBe(60)
  })
})
