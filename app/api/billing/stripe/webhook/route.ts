import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, stripeConfigured, mapSubStatus, subscriptionPeriodEnd, planFromSubscription } from '@/lib/billing/stripe'
import type Stripe from 'stripe'

export const runtime = 'nodejs'

type Admin = ReturnType<typeof createAdminClient>

function customerId(sub: Stripe.Subscription): string | null {
  return typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null
}

// Sync a Stripe subscription onto the matching profile. Prefer the userId we
// stamped at checkout (metadata / client_reference_id); fall back to the Stripe
// customer id we persisted.
async function applySubscription(admin: Admin, sub: Stripe.Subscription, userIdHint?: string) {
  const userId = (sub.metadata?.userId as string | undefined) || userIdHint
  const plan = planFromSubscription(sub)
  const cust = customerId(sub)
  const patch: Record<string, unknown> = {
    subscription_status: mapSubStatus(sub.status),
    current_period_end: subscriptionPeriodEnd(sub),
    payment_provider: 'stripe',
    provider_subscription_id: sub.id,
    ...(cust ? { provider_customer_id: cust } : {}),
    ...(plan ? { subscription_tier: plan } : {}),
  }
  if (userId) await admin.from('profiles').update(patch).eq('id', userId)
  else if (cust) await admin.from('profiles').update(patch).eq('provider_customer_id', cust)
}

export async function POST(request: Request) {
  if (!stripeConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'billing_not_configured' }, { status: 503 })
  }

  const stripe = getStripe()
  const sig = request.headers.get('stripe-signature') || ''
  const raw = await request.text() // raw body required for signature verification

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (e) {
    console.error('[billing/webhook] bad signature', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'bad_signature' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Idempotency — record the event id; a unique-violation means we already ran it.
  const { error: dupErr } = await admin.from('billing_events').insert({ id: event.id, provider: 'stripe', type: event.type })
  if (dupErr) return NextResponse.json({ received: true, duplicate: true })

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(String(session.subscription))
          await applySubscription(admin, sub as Stripe.Subscription, session.client_reference_id || undefined)
        }
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await applySubscription(admin, event.data.object as Stripe.Subscription)
        break
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const cust = customerId(sub)
        if (cust) await admin.from('profiles').update({ subscription_status: 'canceled' }).eq('provider_customer_id', cust)
        break
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice
        if (inv.customer) await admin.from('profiles').update({ subscription_status: 'past_due' }).eq('provider_customer_id', String(inv.customer))
        break
      }
    }
  } catch (e) {
    console.error('[billing/webhook] handler error', e instanceof Error ? e.message : e)
    // Drop the idempotency row so Stripe's retry re-runs the handler.
    await admin.from('billing_events').delete().eq('id', event.id)
    return NextResponse.json({ error: 'handler_failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
