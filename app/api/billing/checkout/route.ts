import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, stripeConfigured, ensurePrice } from '@/lib/billing/stripe'
import { PAID_PLANS, TRIAL_DAYS, type PaidPlan } from '@/lib/generations-config'

export const runtime = 'nodejs'

// Trial length for Соло on Stripe (Про/Продюсер never get one — they charge
// immediately, matching the Продамус model).
//
// Override with env STRIPE_SOLO_TRIAL_DAYS. `0` disables the trial so a Соло
// checkout charges right away — needed to test the live cards/webhook/ledger
// chain with real money (with a trial Stripe bills $0, so nothing reaches
// /admin/payments and the account's ability to actually take money is untested).
// Unset the env var to restore the normal 60-day trial. Garbage/negative values
// fall back to the default rather than silently charging a real user.
// NOTE: Продамус trials are set on the product in its ЛК — this does not touch them.
function soloTrialDays(): number {
  const raw = process.env.STRIPE_SOLO_TRIAL_DAYS
  if (raw === undefined || raw === '') return TRIAL_DAYS
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : TRIAL_DAYS
}

// Creates a Stripe Checkout Session (hosted page) for a paid plan and returns
// its URL — the client just redirects there. Dormant until STRIPE_SECRET_KEY is
// set (returns 503 'billing_not_configured', which the UI shows softly).
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!stripeConfigured()) return NextResponse.json({ error: 'billing_not_configured' }, { status: 503 })

    const { plan } = (await request.json()) as { plan?: string }
    if (!plan || !PAID_PLANS.includes(plan as PaidPlan)) {
      return NextResponse.json({ error: 'invalid_plan' }, { status: 400 })
    }

    const stripe = getStripe()
    const admin = createAdminClient()

    // Reuse the user's Stripe customer if we have one, else create + persist it.
    const { data: profile } = await admin.from('profiles').select('provider_customer_id').eq('id', user.id).single()
    let customerId = (profile?.provider_customer_id as string | null) || null
    // A stored id may belong to another Stripe mode (test-mode id after the
    // switch to live keys) — verify it exists under the current key, else start fresh.
    if (customerId) {
      try {
        const c = await stripe.customers.retrieve(customerId)
        if ((c as { deleted?: boolean }).deleted) customerId = null
      } catch {
        customerId = null
      }
    }
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email || undefined, metadata: { userId: user.id } })
      customerId = customer.id
      // Persist the customer id for reuse, but do NOT set payment_provider yet —
      // that's the "which provider is actually active" signal and must only be
      // written by the webhook AFTER a successful payment. Writing it here would
      // overwrite a Продамус user's real provider the moment they open Stripe
      // checkout (even if they abandon it), breaking cross-provider cancellation.
      await admin.from('profiles').update({ provider_customer_id: customerId }).eq('id', user.id)
    }

    const priceId = await ensurePrice(plan as PaidPlan)
    const origin = request.headers.get('origin') || 'https://amaproduct.com'

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      // Match the Продамус model: 60-day trial on Соло only; Про/Продюсер charge
      // immediately (no trial). During the trial Stripe sends the subscription as
      // `trialing` and our webhook activates the tier just the same.
      subscription_data: {
        metadata: { userId: user.id, plan },
        ...(plan === 'solo' && soloTrialDays() > 0 ? { trial_period_days: soloTrialDays() } : {}),
      },
      allow_promotion_codes: true,
      success_url: `${origin}/pricing?status=success`,
      cancel_url: `${origin}/pricing?status=cancel`,
    })

    return NextResponse.json({ url: session.url })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'failed'
    console.error('[billing/checkout]', msg)
    const status = msg === 'billing_not_configured' ? 503 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
