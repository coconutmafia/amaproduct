import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, stripeConfigured, mapSubStatus, subscriptionPeriodEnd, planFromSubscription } from '@/lib/billing/stripe'
import { cancelSubscriptionAnyProvider } from '@/lib/billing/cancel'
import type Stripe from 'stripe'

export const runtime = 'nodejs'

type Admin = ReturnType<typeof createAdminClient>

// Persist a webhook failure so it shows in /admin/errors (and is queryable) —
// console.error alone lives only in Vercel logs. Best-effort: never throw.
async function logWebhook(message: string, context: Record<string, unknown>) {
  try {
    await createAdminClient().from('error_events').insert({
      level: 'error', source: 'webhook', route: '/api/billing/stripe/webhook', message, context,
    })
  } catch { /* logging must never break the webhook */ }
}

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

  // Read the currently-stored subscription id for this user/customer once.
  const prevQuery = userId
    ? admin.from('profiles').select('provider_subscription_id').eq('id', userId).maybeSingle()
    : cust ? admin.from('profiles').select('provider_subscription_id').eq('provider_customer_id', cust).maybeSingle()
    : null
  const prevSub = prevQuery ? ((await prevQuery).data?.provider_subscription_id as string | null | undefined) : undefined

  // Out-of-order guard (Stripe doesn't guarantee delivery order): a `created`/
  // `updated` event for a CANCELED subscription that is NOT the one we currently
  // store is stale — acting on it would cancel the NEW active sub and revert the
  // tier. Ignore it. (The scoped `deleted` branch handles a real current-sub cancel.)
  if (sub.status === 'canceled' && prevSub && String(prevSub) !== sub.id) return

  // Plan switch: if the user already had a DIFFERENT subscription, cancel it so
  // they aren't billed for both. The stored id may belong to EITHER provider (a
  // region switch), so dispatch by id shape — feeding a Продамус id to Stripe (or
  // vice-versa) would silently no-op and double-charge. Best-effort: a failed
  // cancel just leaves the old sub (logged). Scoped-delete of the deleted event
  // below prevents this cancellation from wiping the new active tier.
  if (prevSub && String(prevSub) !== sub.id) {
    const r = await cancelSubscriptionAnyProvider(String(prevSub))
    if (!r.ok) {
      console.error('[billing/webhook] cancel old sub failed', r.provider, r.detail)
      await logWebhook('stripe: не удалось отменить прошлую подписку при смене тарифа', {
        prev: String(prevSub), next: sub.id, provider: r.provider, detail: r.detail ?? null,
      })
    }
  }

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
    await logWebhook('stripe webhook hit but billing_not_configured (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET missing)', {})
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
    // Live-switch tripwire: the most likely cause is STRIPE_WEBHOOK_SECRET not
    // matching the endpoint's mode (test secret with a live endpoint or vice versa).
    await logWebhook('stripe webhook: подпись не сошлась (bad_signature)', {
      detail: e instanceof Error ? e.message : String(e), hasSignatureHeader: !!sig,
    })
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
        // Only mark canceled if this is the user's CURRENT subscription. An old
        // sub cleaned up during a plan switch must NOT cancel the new active one.
        if (cust) {
          await admin.from('profiles')
            .update({ subscription_status: 'canceled' })
            .eq('provider_customer_id', cust)
            .eq('provider_subscription_id', sub.id)
        }
        break
      }
      case 'invoice.payment_succeeded': {
        const inv = event.data.object as Stripe.Invoice
        // Ledger row for /admin/payments (deduped by the (provider, external_id)
        // unique index — a re-delivered webhook won't double-insert). $0 invoices
        // (trial start) are noise, skip them. Best-effort: an insert error must
        // not fail the webhook.
        const cust = inv.customer ? String(inv.customer) : null
        if (cust && (inv.amount_paid ?? 0) > 0) {
          const { data: prof } = await admin.from('profiles').select('id').eq('provider_customer_id', cust).maybeSingle()
          await admin.from('payments').insert({
            user_id: prof?.id ?? null,
            amount: Math.round(inv.amount_paid) / 100, // cents → dollars
            currency: (inv.currency || 'usd').toUpperCase(),
            status: 'succeeded',
            provider: 'stripe',
            external_id: inv.id,
            description: inv.lines?.data?.[0]?.description || 'Stripe',
          })
          if (!prof?.id) {
            await logWebhook('stripe webhook: оплата прошла, но пользователь не найден по customer id', {
              customer: cust, invoice: inv.id, amount: inv.amount_paid,
            })
          }
        }
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
    await logWebhook('stripe webhook: ошибка обработчика после проверки подписи', {
      eventId: event.id, eventType: event.type, error: e instanceof Error ? e.message : String(e),
    })
    // Drop the idempotency row so Stripe's retry re-runs the handler.
    await admin.from('billing_events').delete().eq('id', event.id)
    return NextResponse.json({ error: 'handler_failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
