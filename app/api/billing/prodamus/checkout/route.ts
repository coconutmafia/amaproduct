import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prodamusConfigured, prodamusFormUrl, prodamusSubId, prodamusLink, buildOrderId } from '@/lib/billing/prodamus'
import { PAID_PLANS, type PaidPlan } from '@/lib/generations-config'

export const runtime = 'nodejs'

// Builds a Продамус payform subscription link for a plan and returns its URL.
// The subscription's price/period/demo come from the product in the личный
// кабинет (referenced by id); we just pass the customer + return/notify URLs.
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!prodamusConfigured()) return NextResponse.json({ error: 'billing_not_configured' }, { status: 503 })

    const { plan } = (await request.json()) as { plan?: string }
    if (!plan || !PAID_PLANS.includes(plan as PaidPlan)) return NextResponse.json({ error: 'invalid_plan' }, { status: 400 })

    const link = prodamusLink(plan as PaidPlan)
    const subId = prodamusSubId(plan as PaidPlan)
    if (!link && !subId) return NextResponse.json({ error: 'subscription_not_configured' }, { status: 503 })

    const origin = request.headers.get('origin') || 'https://amaproduct.com'
    const orderId = buildOrderId(user.id, plan as PaidPlan, Date.now())

    // Prefer the ready subscription link from the ЛК (e.g. payform.ru/k4bMP2U/);
    // else fall back to the base form + subscription id.
    const url = new URL(link || prodamusFormUrl())
    url.searchParams.set('order_id', orderId)
    if (user.email) url.searchParams.set('customer_email', user.email)
    if (!link && subId) url.searchParams.set('subscription', subId)
    url.searchParams.set('urlSuccess', `${origin}/pricing?status=success`)
    url.searchParams.set('urlReturn', `${origin}/pricing`)
    url.searchParams.set('urlNotification', `${origin}/api/billing/prodamus/webhook`)

    return NextResponse.json({ url: url.toString() })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'failed'
    console.error('[billing/prodamus/checkout]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
