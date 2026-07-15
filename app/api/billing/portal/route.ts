import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, stripeConfigured } from '@/lib/billing/stripe'

export const runtime = 'nodejs'

// Opens the Stripe Billing Portal so a paying user can manage / cancel / update
// their subscription. Returns a URL to redirect to.
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!stripeConfigured()) return NextResponse.json({ error: 'billing_not_configured' }, { status: 503 })

    const admin = createAdminClient()
    const { data: profile } = await admin.from('profiles').select('provider_customer_id').eq('id', user.id).single()
    const customer = profile?.provider_customer_id as string | null
    if (!customer) return NextResponse.json({ error: 'no_subscription' }, { status: 400 })

    const stripe = getStripe()
    const origin = request.headers.get('origin') || 'https://amaproduct.com'
    try {
      const session = await stripe.billingPortal.sessions.create({ customer, return_url: `${origin}/settings` })
      return NextResponse.json({ url: session.url })
    } catch (e) {
      // Stored id from another Stripe mode (test → live switch): no such customer.
      if ((e as { code?: string }).code === 'resource_missing') {
        return NextResponse.json({ error: 'no_subscription' }, { status: 400 })
      }
      throw e
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'failed'
    console.error('[billing/portal]', msg)
    const status = msg === 'billing_not_configured' ? 503 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
