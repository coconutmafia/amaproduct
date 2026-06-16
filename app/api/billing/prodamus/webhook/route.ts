import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { prodamusConfigured, prodamusVerify, parseFormNested, parseOrderId, mapProdamusStatus } from '@/lib/billing/prodamus'

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
        const patch: Record<string, unknown> = {
          subscription_status: mapProdamusStatus(status),
          payment_provider: 'prodamus',
          current_period_end: new Date(Date.now() + 31 * 24 * 3600 * 1000).toISOString(),
          ...(parsed?.plan ? { subscription_tier: parsed.plan } : {}),
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
