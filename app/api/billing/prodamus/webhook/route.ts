import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { prodamusConfigured, prodamusVerify, parseFormNested, parseOrderId, mapProdamusStatus } from '@/lib/billing/prodamus'
import { PLAN_CONFIG, type SubscriptionTier } from '@/lib/generations-config'

export const runtime = 'nodejs'

// Продамус posts payment notifications here (x-www-form-urlencoded) with the HMAC
// in the `Sign` header. We verify it, then sync the subscription onto the profile.
// ⚠️ Needs a live test callback at activation to confirm the exact field names /
// signature match (logged on mismatch to help tune).
export async function POST(request: Request) {
  if (!prodamusConfigured()) return NextResponse.json({ error: 'billing_not_configured' }, { status: 503 })

  const raw = await request.text()
  const sign = request.headers.get('sign') || request.headers.get('Sign') || ''
  const data = parseFormNested(raw)
  // Signature is delivered in the header; the body shouldn't carry it, but strip
  // defensively in case a variant echoes it.
  delete (data as Record<string, unknown>).signature
  delete (data as Record<string, unknown>).sign

  if (!prodamusVerify(data, sign)) {
    console.error('[prodamus/webhook] bad signature; keys=', Object.keys(data).join(','))
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
      if (userId) {
        // Guard against order_id tampering → tier escalation. The plan is encoded
        // in order_id (a URL query param the payer can edit before paying), but
        // the actual PRICE is fixed by the Продамус link/subscription. So a payer
        // could open the "solo" link, rewrite order_id to "producer" and get the
        // top tier for the cheap price. Only grant the tier if the paid `sum`
        // covers that plan's price. Fail-safe: if we can't read a sum, keep prior
        // behaviour (Продамус is not live-verified yet — see ⚠️ above).
        let grantedPlan = parsed?.plan
        if (grantedPlan) {
          const expected = PLAN_CONFIG[grantedPlan as SubscriptionTier]?.priceRub
          const paid = Number(data.sum ?? (data as Record<string, unknown>).amount ?? NaN)
          if (expected && Number.isFinite(paid) && paid + 1 < expected) {
            console.error(`[prodamus/webhook] amount mismatch: paid ${paid}₽ < ${grantedPlan} (${expected}₽) — refusing tier escalation; order_id=${orderId}`)
            grantedPlan = undefined // underpaid → don't escalate tier
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
    await admin.from('billing_events').delete().eq('id', eventId)
    return NextResponse.json({ error: 'handler_failed' }, { status: 500 })
  }

  // Продамус expects a 200; echo "success" as some configs check the body.
  return new NextResponse('success', { status: 200 })
}
