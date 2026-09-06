import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, stripeConfigured } from '@/lib/billing/stripe'
import { prodamusConfigured, prodamusTopupLink } from '@/lib/billing/prodamus'
import { PLAN_CONFIG, PAID_PLANS, type PaidPlan } from '@/lib/generations-config'
import { hasActivePaidSubscription } from '@/lib/billing/planState'

export const runtime = 'nodejs'

// POST /api/billing/topup { region: 'ru'|'intl' } — докупить объём СВОЕГО
// тарифа раньше срока (мандат Матвея 06.09). Разовый платёж; рекуррент не
// трогаем. Stripe: checkout mode=payment с price_data (без предсозданного
// price). Продамус: разовый продукт из ЛК — ссылка в env PRODAMUS_LINK_TOPUP_<PLAN>.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { region?: string } = {}
  try { body = await request.json() } catch { /* default */ }
  const region = body.region === 'intl' ? 'intl' : 'ru'

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('subscription_tier, subscription_status, payment_provider, provider_customer_id')
    .eq('id', user.id)
    .single()
  const plan = profile?.subscription_tier as PaidPlan | undefined
  if (!plan || !PAID_PLANS.includes(plan)) return NextResponse.json({ error: 'Докупка доступна на платном тарифе' }, { status: 400 })
  if (!hasActivePaidSubscription(profile?.subscription_status, profile?.payment_provider)) {
    return NextResponse.json({ error: 'Сначала оформи подписку — докупка доступна на действующей' }, { status: 400 })
  }
  const cfg = PLAN_CONFIG[plan]
  const origin = request.headers.get('origin') || 'https://amaproduct.com'

  if (region === 'intl') {
    if (!stripeConfigured()) return NextResponse.json({ error: 'billing_not_configured' }, { status: 503 })
    const stripe = getStripe()
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      ...(profile?.provider_customer_id ? { customer: profile.provider_customer_id as string } : { customer_email: user.email || undefined }),
      client_reference_id: user.id,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: cfg.price * 100,
          product_data: { name: `AVA · ещё ${cfg.generations} единиц контента («${cfg.label}»)` },
        },
      }],
      metadata: { userId: user.id, type: 'topup', plan },
      success_url: `${origin}/pricing?status=topup_success`,
      cancel_url: `${origin}/pricing?status=cancel`,
    })
    return NextResponse.json({ url: session.url })
  }

  if (!prodamusConfigured()) return NextResponse.json({ error: 'billing_not_configured' }, { status: 503 })
  const link = prodamusTopupLink(plan)
  if (!link) return NextResponse.json({ error: 'topup_not_configured' }, { status: 503 })
  const url = new URL(link)
  url.searchParams.set('order_id', `${user.id}.topup-${plan}.${Date.now()}`)
  if (user.email) url.searchParams.set('customer_email', user.email)
  url.searchParams.set('urlSuccess', `${origin}/pricing?status=topup_success`)
  url.searchParams.set('urlReturn', `${origin}/pricing`)
  url.searchParams.set('urlNotification', `${origin}/api/billing/prodamus/webhook`)
  return NextResponse.json({ url: url.toString() })
}
