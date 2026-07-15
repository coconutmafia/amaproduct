import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { prodamusConfigured, prodamusVerify, parseFormNested, parseOrderId, mapProdamusStatus } from '@/lib/billing/prodamus'
import { PLAN_CONFIG, PAID_PLANS } from '@/lib/generations-config'

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
      // Продамус returns its OWN numeric order_id (NOT our userId.plan.ts — ready
      // subscription links drop appended query params) plus a full `subscription`
      // object and customer_email. So resolve:
      //   • PLAN — from the subscription's real recurring cost (tamper-proof: set
      //     by Продамус, not the payer), fallback to its RU name.
      //   • USER — by the payer's email (survives), fallback to a stored
      //     subscription id (recurring rebills) or our order_id if it ever survives.
      const parsed = parseOrderId(orderId)
      const sub = (data.subscription && typeof data.subscription === 'object')
        ? (data.subscription as Record<string, unknown>) : null
      const subId = sub?.id ?? (data as Record<string, unknown>).subscription_id ?? null

      // Plan: subscription cost → RU name → our order_id.
      let grantedPlan: string | undefined
      const subCost = sub ? Math.round(Number(sub.cost)) : NaN
      if (Number.isFinite(subCost)) grantedPlan = PAID_PLANS.find((p) => PLAN_CONFIG[p].priceRub === subCost)
      if (!grantedPlan && sub?.name) {
        const nameMap: Record<string, string> = { 'соло': 'solo', 'про': 'pro', 'продюсер': 'producer' }
        grantedPlan = nameMap[String(sub.name).trim().toLowerCase()]
      }
      if (!grantedPlan) grantedPlan = parsed?.plan

      // User: our order_id → payer email → stored subscription id.
      let userId = parsed?.userId
      if (!userId && data.customer_email) {
        const { data: prof } = await admin.from('profiles').select('id').ilike('email', String(data.customer_email)).maybeSingle()
        userId = prof?.id
      }
      if (!userId && subId) {
        const { data: prof } = await admin.from('profiles').select('id').eq('provider_subscription_id', String(subId)).maybeSingle()
        userId = prof?.id
      }

      const paidSum = Number(data.sum ?? (data as Record<string, unknown>).amount ?? NaN)
      // Ledger (shows in /admin/payments) — best-effort, deduped by external_id.
      try {
        await admin.from('payments').insert({
          user_id: userId ?? null,
          amount: Number.isFinite(paidSum) ? paidSum : 0,
          currency: String(data.currency ?? 'RUB'),
          status: 'succeeded',
          provider: 'prodamus',
          external_id: orderId || (subId ? String(subId) : null),
          description: grantedPlan ? `Prodamus · ${grantedPlan}` : 'Prodamus',
        })
      } catch { /* ledger insert is best-effort */ }

      if (!userId) {
        await logWebhook('prodamus webhook: платёж прошёл, но пользователь не найден (email/подписка не сопоставлены)', {
          order_id: orderId, email: data.customer_email ?? null, subscription_id: subId, plan: grantedPlan ?? null,
        })
      } else {
        // Access valid until the subscription's next payment date (60-day demo),
        // fallback to +31 days if it's missing/unparseable.
        let periodEnd = new Date(Date.now() + 31 * 24 * 3600 * 1000)
        if (sub?.date_next_payment) {
          const d = new Date(String(sub.date_next_payment).replace(' ', 'T'))
          if (!Number.isNaN(d.getTime())) periodEnd = d
        }
        const patch: Record<string, unknown> = {
          subscription_status: mapProdamusStatus(status),
          payment_provider: 'prodamus',
          current_period_end: periodEnd.toISOString(),
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
