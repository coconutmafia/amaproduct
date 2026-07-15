import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { prodamusConfigured, prodamusVerify, parseFormNested, parseOrderId, mapProdamusStatus } from '@/lib/billing/prodamus'
import { PLAN_CONFIG, PAID_PLANS, type SubscriptionTier } from '@/lib/generations-config'

export const runtime = 'nodejs'

// Продамус posts payment notifications here (x-www-form-urlencoded) with the HMAC
// in the `Sign` header. We verify it, then sync the subscription onto the profile.
// ⚠️ Needs a live test callback at activation to confirm the exact field names /
// signature match (logged on mismatch to help tune).
// Persist a webhook failure so it shows in /admin/errors (and is queryable) —
// console.error alone lives only in Vercel logs. Best-effort: never throw.
async function logWebhook(message: string, context: Record<string, unknown>) {
  try {
    await createAdminClient().from('error_events').insert({
      level: 'error', source: 'webhook', route: '/api/billing/prodamus/webhook', message, context,
    })
  } catch { /* logging must never break the webhook */ }
}

export async function POST(request: Request) {
  if (!prodamusConfigured()) {
    await logWebhook('prodamus webhook hit but billing_not_configured (PRODAMUS_SECRET_KEY missing)', {})
    return NextResponse.json({ error: 'billing_not_configured' }, { status: 503 })
  }

  const raw = await request.text()
  const data = parseFormNested(raw)
  // Продамус may deliver the signature in the `Sign` header OR in the body as a
  // `signature`/`sign` field — accept either. Capture the body value BEFORE we
  // strip it (the signature is computed over the data without the sig field).
  const bodySign = String((data as Record<string, unknown>).signature ?? (data as Record<string, unknown>).sign ?? '')
  delete (data as Record<string, unknown>).signature
  delete (data as Record<string, unknown>).sign
  const sign = request.headers.get('sign') || request.headers.get('Sign') || bodySign

  if (!prodamusVerify(data, sign)) {
    const keys = Object.keys(data).join(',')
    console.error('[prodamus/webhook] bad signature; keys=', keys)
    await logWebhook('prodamus webhook: подпись не сошлась (bad_signature)', {
      receivedKeys: keys, signFrom: request.headers.get('sign') || request.headers.get('Sign') ? 'header' : (bodySign ? 'body' : 'none'),
      order_id: data.order_id ?? null, payment_status: data.payment_status ?? null,
    })
    return NextResponse.json({ error: 'bad_signature' }, { status: 400 })
  }

  const admin = createAdminClient()
  const orderId = String(data.order_id ?? '')
  const status = String(data.payment_status ?? '')
  const date = String(data.date ?? status)
  // No provider event id — dedupe on order_id + charge date (a rebill has a new date).
  const eventId = `prodamus:${orderId}:${date}`
  const { error: dupErr } = await admin.from('billing_events').insert({ id: eventId, provider: 'prodamus', type: status })
  if (dupErr) return NextResponse.json({ received: true, duplicate: true })

  try {
    if (status.toLowerCase() === 'success') {
      const parsed = parseOrderId(orderId)
      const subId = data.subscription ?? (data as Record<string, unknown>).subscription_id
      // Find the user: by encoded order_id (first payment) or by stored subscription id (rebill).
      let userId = parsed?.userId
      if (!userId && subId) {
        const { data: prof } = await admin.from('profiles').select('id').eq('provider_subscription_id', String(subId)).maybeSingle()
        userId = prof?.id
      }
      const paidSum = Number(data.sum ?? (data as Record<string, unknown>).amount ?? NaN)
      // Record the charge in the payments ledger (shows in /admin/payments),
      // regardless of whether we could resolve the user — best-effort, deduped
      // by the unique (provider, external_id) index.
      try {
        await admin.from('payments').insert({
          user_id: userId ?? null,
          amount: Number.isFinite(paidSum) ? paidSum : 0,
          currency: String(data.currency ?? 'RUB'),
          status: 'succeeded',
          provider: 'prodamus',
          external_id: orderId || (subId ? String(subId) : null),
          description: parsed?.plan ? `Prodamus · ${parsed.plan}` : 'Prodamus',
        })
      } catch { /* ledger insert is best-effort */ }

      if (!userId) {
        await logWebhook('prodamus webhook: платёж прошёл, но пользователь не найден (order_id/subscription не сопоставлены)', {
          order_id: orderId, subscription: subId ?? null, sum: data.sum ?? null,
        })
      }
      if (userId) {
        // Guard against order_id tampering → tier escalation. The plan is encoded
        // in order_id (a URL query param the payer can edit before paying), but
        // the actual PRICE is fixed by the Продамус link/subscription. So a payer
        // could open the "solo" link, rewrite order_id to "producer" and get the
        // top tier for the cheap price.
        //
        // ⚠️ The trial's FIRST payment is tiny — 1₽ (Продамус forbids a 0₽ first
        // payment) — and its activation webhook carries that small sum. That is NOT
        // an underpayment, it's the legitimate trial start. A REAL underpayment is
        // «paid a genuine plan-level amount but claimed a pricier tier». So only
        // reject when the paid sum is at least the cheapest paid plan's price AND
        // below the claimed tier; anything smaller (the 1₽ trial) passes and
        // activates the tier. Recurring charges (real amounts) are still checked.
        const minPaidPrice = Math.min(...PAID_PLANS.map((p) => PLAN_CONFIG[p].priceRub))
        let grantedPlan = parsed?.plan
        if (grantedPlan) {
          const expected = PLAN_CONFIG[grantedPlan as SubscriptionTier]?.priceRub
          const paid = Number(data.sum ?? (data as Record<string, unknown>).amount ?? NaN)
          if (expected && Number.isFinite(paid) && paid >= minPaidPrice && paid + 1 < expected) {
            console.error(`[prodamus/webhook] amount mismatch: paid ${paid}₽ < ${grantedPlan} (${expected}₽) — refusing tier escalation; order_id=${orderId}`)
            grantedPlan = undefined // real underpayment → don't escalate tier
          }
        }
        const patch: Record<string, unknown> = {
          subscription_status: mapProdamusStatus(status),
          payment_provider: 'prodamus',
          current_period_end: new Date(Date.now() + 31 * 24 * 3600 * 1000).toISOString(),
          ...(grantedPlan ? { subscription_tier: grantedPlan } : {}),
          ...(subId ? { provider_subscription_id: String(subId) } : {}),
        }
        await admin.from('profiles').update(patch).eq('id', userId)
      }
    }
  } catch (e) {
    console.error('[prodamus/webhook] handler error', e instanceof Error ? e.message : e)
    await logWebhook('prodamus webhook: ошибка обработчика после проверки подписи', {
      order_id: orderId, error: e instanceof Error ? e.message : String(e),
    })
    await admin.from('billing_events').delete().eq('id', eventId)
    return NextResponse.json({ error: 'handler_failed' }, { status: 500 })
  }

  // Продамус expects a 200; echo "success" as some configs check the body.
  return new NextResponse('success', { status: 200 })
}
