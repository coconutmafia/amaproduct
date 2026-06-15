import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, stripeConfigured, ensurePrice } from '@/lib/billing/stripe'
import { PAID_PLANS, type PaidPlan } from '@/lib/generations-config'

export const runtime = 'nodejs'

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
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email || undefined, metadata: { userId: user.id } })
      customerId = customer.id
      await admin.from('profiles').update({ provider_customer_id: customerId, payment_provider: 'stripe' }).eq('id', user.id)
    }

    const priceId = await ensurePrice(plan as PaidPlan)
    const origin = request.headers.get('origin') || 'https://amaproduct.com'

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { userId: user.id, plan } },
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
