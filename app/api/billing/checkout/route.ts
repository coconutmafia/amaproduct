import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, stripeConfigured, ensurePrice } from '@/lib/billing/stripe'
import { PAID_PLANS, TRIAL_DAYS, type PaidPlan } from '@/lib/generations-config'

export const runtime = 'nodejs'

// Trial length for Соло on Stripe. DEFAULT = TRIAL_DAYS (60).
//
// ЭТО РАБОЧАЯ МОДЕЛЬ, А НЕ ТЕСТОВАЯ НАСТРОЙКА — не «чини» её, увидев нулевые инвойсы:
// Августа продаёт своим клиентам доступ с ДВУМЯ МЕСЯЦАМИ бесплатно. Клиент обязан
// ОФОРМИТЬ подписку (привязать карту) — и только тогда получает доступ; деньги
// списываются через 60 дней. Поэтому `trialing` и $0 в первом инвойсе — норма.
// В Продамусе то же самое делает демо-период на продукте (задаётся в его ЛК): 1₽ +
// демо ≈ тот же смысл, потому что Продамус запрещает нулевой первый платёж.
// Обе платёжки обязаны вести себя ОДИНАКОВО — это одни и те же клиенты.
//
// Что НЕ даёт бесплатный доступ: регистрация без оформления подписки. Это закрывает
// миграция 034 (trial_ends_at = now() у новых) + BILLING_ENFORCED — «плати сразу»
// означает «оформи подписку сразу», а не «спиши деньги сразу».
//
// Env STRIPE_SOLO_TRIAL_DAYS временно ставили в 0, чтобы проверить живое списание
// настоящей картой (с триалом Stripe берёт $0 и приём денег не проверяется). Это
// разовый тест — после него переменную убирают, и дефолт возвращает 60.
// Мусор/отрицательное → дефолт, чтобы случайно не списать с клиента полную цену.
function soloTrialDays(): number {
  const raw = process.env.STRIPE_SOLO_TRIAL_DAYS
  if (raw === undefined || raw === '') return TRIAL_DAYS
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : TRIAL_DAYS
}

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
    // A stored id may belong to another Stripe mode (test-mode id after the
    // switch to live keys) — verify it exists under the current key, else start fresh.
    if (customerId) {
      try {
        const c = await stripe.customers.retrieve(customerId)
        if ((c as { deleted?: boolean }).deleted) customerId = null
      } catch {
        customerId = null
      }
    }
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email || undefined, metadata: { userId: user.id } })
      customerId = customer.id
      // Persist the customer id for reuse, but do NOT set payment_provider yet —
      // that's the "which provider is actually active" signal and must only be
      // written by the webhook AFTER a successful payment. Writing it here would
      // overwrite a Продамус user's real provider the moment they open Stripe
      // checkout (even if they abandon it), breaking cross-provider cancellation.
      await admin.from('profiles').update({ provider_customer_id: customerId }).eq('id', user.id)
    }

    const priceId = await ensurePrice(plan as PaidPlan)
    const origin = request.headers.get('origin') || 'https://amaproduct.com'

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      // Соло — 60 дней бесплатно (клиенты Августы приходят именно на этих условиях),
      // Про/Продюсер — списание сразу. Во время триала Stripe присылает подписку как
      // `trialing`, и наш вебхук активирует тариф так же. Зеркало демо-периода Продамуса.
      subscription_data: {
        metadata: { userId: user.id, plan },
        ...(plan === 'solo' && soloTrialDays() > 0 ? { trial_period_days: soloTrialDays() } : {}),
      },
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
