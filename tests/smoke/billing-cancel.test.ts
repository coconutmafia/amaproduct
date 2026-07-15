import { describe, it, expect } from 'vitest'
import { subscriptionProviderOf } from '@/lib/billing/cancel'

// The crux of the double-charge fix: a stored provider_subscription_id can belong
// to EITHER provider (a user who switched regions). Cancellation MUST be routed by
// id shape — feeding a Stripe id to Продамус (or vice-versa) silently no-ops and
// leaves the old subscription billing forever. A regression here = double charge.
describe('subscriptionProviderOf — cross-provider cancel dispatch', () => {
  it('routes Stripe subscription ids (sub_…) to stripe', () => {
    expect(subscriptionProviderOf('sub_1TtTZUEf6x7NjLbKbPKQwIjU')).toBe('stripe')
  })

  it('routes Stripe customer ids (cus_…) to stripe', () => {
    expect(subscriptionProviderOf('cus_UtEMSHQ0DWk8gJ')).toBe('stripe')
  })

  it('routes numeric Продамус ids to prodamus', () => {
    expect(subscriptionProviderOf('2946756')).toBe('prodamus')
    expect(subscriptionProviderOf('123456')).toBe('prodamus')
  })

  it('defaults an unrecognised shape to prodamus (numeric-style ids only)', () => {
    // Продамус ids are purely numeric; anything without the Stripe prefix is
    // treated as Продамус, matching the real id space of the two providers.
    expect(subscriptionProviderOf('987654321')).toBe('prodamus')
  })
})
