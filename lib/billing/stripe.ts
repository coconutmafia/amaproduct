// Server-only Stripe helpers. The SDK client is created lazily so the app builds
// and runs WITHOUT any Stripe keys — billing endpoints just report "not
// configured" until STRIPE_SECRET_KEY is set in env (owner adds it at launch).
import Stripe from 'stripe'
import { PLAN_CONFIG, type PaidPlan } from '@/lib/generations-config'

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

let _stripe: Stripe | null = null
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('billing_not_configured')
  // Pin the SDK's default API version (omit → SDK default); avoids guessing a literal.
  if (!_stripe) _stripe = new Stripe(key)
  return _stripe
}

// Stable lookup keys so we never hardcode Price IDs (and never need extra env vars).
const LOOKUP: Record<PaidPlan, string> = {
  solo: 'ama_solo_monthly',
  pro: 'ama_pro_monthly',
  producer: 'ama_producer_monthly',
}

export function planFromLookupKey(lk?: string | null): PaidPlan | null {
  const e = (Object.entries(LOOKUP) as [PaidPlan, string][]).find(([, v]) => v === lk)
  return e ? e[0] : null
}

// Find the monthly Price for a plan, creating the Product+Price on first use so
// the owner doesn't have to set anything up in the Stripe dashboard by hand.
// Charges in USD (PRICING.md $ amounts) — Stripe is the "мир" provider; РФ uses Продамус.
export async function ensurePrice(plan: PaidPlan): Promise<string> {
  const stripe = getStripe()
  const lookup = LOOKUP[plan]
  const existing = await stripe.prices.list({ lookup_keys: [lookup], active: true, limit: 1 })
  if (existing.data[0]) return existing.data[0].id

  const cfg = PLAN_CONFIG[plan]
  const product = await stripe.products.create({ name: `AMA — ${cfg.label}`, metadata: { plan } })
  const price = await stripe.prices.create({
    product: product.id,
    currency: 'usd',
    unit_amount: Math.round(cfg.price * 100),
    recurring: { interval: 'month' },
    lookup_key: lookup,
    metadata: { plan },
  })
  return price.id
}

// Stripe subscription.status → our profiles.subscription_status domain.
export function mapSubStatus(s: Stripe.Subscription.Status): string {
  switch (s) {
    case 'active':
    case 'trialing':
      return 'active'
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return 'past_due'
    case 'paused':
      return 'paused'
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled'
    default:
      return 'past_due'
  }
}

// Period end moved between the subscription and its items across API versions —
// read it from whichever place the current account returns.
export function subscriptionPeriodEnd(sub: Stripe.Subscription): string | null {
  const any = sub as unknown as {
    current_period_end?: number
    items?: { data?: Array<{ current_period_end?: number }> }
  }
  const ts = any.items?.data?.[0]?.current_period_end ?? any.current_period_end
  return ts ? new Date(ts * 1000).toISOString() : null
}

export function planFromSubscription(sub: Stripe.Subscription): PaidPlan | null {
  const lookup = sub.items?.data?.[0]?.price?.lookup_key
  return planFromLookupKey(lookup) || (sub.metadata?.plan as PaidPlan | undefined) || null
}
